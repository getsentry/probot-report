const _ = require('lodash');
const Botkit = require('botkit');
const moment = require('moment');
const EventEmitter = require('events');
const { shouldPerform } = require('./utils');

/**
 * Event emitted when generating reports
 */
const EVENT_REQUEST_REPORT = 'slack.request.report';

/**
 * Regex used for parsing emails
 */
const REGEX_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}\b/i;

/**
 * Regex used for parsing GitHub profiles
 */
const REGEX_GITHUB = /^<https:\/\/github\.com\/([^/>]+)\/?>/;

module.exports = class Slack {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;

    const slackLogger = { log: (level, ...other) => (logger[level] || _.noop)(...other) };
    this.controller = Botkit.slackbot({ logger: slackLogger, logLevel: process.env.LOG_LEVEL });
    this.bot = this.controller.spawn({ token: process.env.SLACK_TOKEN });
    this.emitter = new EventEmitter();

    this.startRtm();
    this.setupCallbacks();
  }

  teardown() {
    this.logger.info('Closing Slack RTM');
    this.bot.closeRTM();
  }

  startRtm() {
    this.bot.startRTM((err) => {
      if (err) {
        this.logger.warn('Failed to start Slack RTM');
        setTimeout(this.startRtm, 60000);
      } else {
        this.logger.info('Slack RTM started successfully');
      }
    });
  }

  onRequestReport(callback) {
    this.emitter.on(EVENT_REQUEST_REPORT, callback);
    return this;
  }

  getConnectedUser(message) {
    const { users } = this.config.get();
    return _.find(users, user => user.slack && (user.slack.user === message.user));
  }

  send(src, message, callback) {
    this.logger.debug('Sending slack message', message);
    if (shouldPerform()) {
      this.bot.whisper(src, message, callback);
    }
  }

  sendHelp(src) {
    this.send(src,
      'Here are a few commands you can run:\n' +
      '  :one:  `list` _lists your PRs on github to review_\n' +
      '  :two:  `slack on` / `slack off` _toggle notifications via slack_\n' +
      '  :three:  `set email <email>` _update your email address_\n' +
      '  :four:  `set <oldest|newest> first` _configure the order of PRs_\n' +
      '  :five:  `get config` _list the config for your user_\n' +
      '',
    );
  }

  handleConnectedMessage(message, user) {
    const text = message.text.trim().toLowerCase();
    const emailMatch = REGEX_EMAIL.exec(text);

    if (text === 'slack on') {
      this.send(message, ':white_check_mark: You will now receive notifications via slack.');
      this.config.mergeUser(user.login, { slack: { ...user.slack, active: true } });
    } else if (text === 'slack off') {
      this.send(message, ':no_entry_sign: You no longer receive notifications via slack.');
      this.config.mergeUser(user.login, { slack: { ...user.slack, active: false } });
    } else if (text === 'set oldest first') {
      this.send(message, ':white_check_mark: Showing *oldest* issues first.');
      this.config.mergeUser(user.login, { order: 'asc' });
    } else if (text === 'set newest first') {
      this.send(message, ':white_check_mark: Showing *newest* issues first.');
      this.config.mergeUser(user.login, { order: 'desc' });
    } else if (text === 'list') {
      this.send(message, ':eyes: Gimme a second...');
      this.emitter.emit(EVENT_REQUEST_REPORT, user);
    } else if (emailMatch !== null) {
      this.send(message, `:white_check_mark: Updated email to *${emailMatch[0]}*`);
      this.config.mergeUser(user.login, { email: emailMatch[0] });
    } else if (text === 'get config') {
      this.send(message, `\`\`\`\n${JSON.stringify(user, null, 4)}\n\`\`\``);
    } else if (text === 'get schwifty') {
      this.send(message, 'https://www.youtube.com/watch?v=I1188GO4p1E');
    } else {
      this.sendHelp(message);
    }
  }

  handleUnconnectedMessage(message) {
    const githubLoginMatch = REGEX_GITHUB.exec(message.text);
    if (githubLoginMatch == null) {
      this.send(message,
        'Greetings stranger, to get started I need to identify who you are.\n' +
        'Please paste the url of your Github profile so I can match you to my database. :fine:',
      );

      return;
    }

    const slack = {
      user: message.user,
      channel: message.channel,
      active: true,
    };

    this.config.mergeUser(githubLoginMatch[1], { slack });
    this.send(message, `Ayo *${githubLoginMatch[1]}*, I know who you are now. :heart:`);
    this.sendHelp(message);
  }

  handleDirectMessage(message) {
    const user = this.getConnectedUser(message);
    if (user) {
      this.handleConnectedMessage(message, user);
    } else {
      this.handleUnconnectedMessage(message);
    }
  }

  setupCallbacks() {
    this.controller.on('rtm_close', () => this.startRtm());
    this.controller.on('direct_message', (bot, message) => this.handleDirectMessage(message));
  }

  static createIssueAttachment(issue, params) {
    const repo = issue.repository_url.match('[^/]+/[^/]+$')[0];
    const opened = moment(issue.created_at).fromNow();
    const updated = moment(issue.updated_at).fromNow();

    return {
      ...params,
      fallback: `*${repo}#${issue.number}*: ${issue.title} (${issue.html_url})`,
      author_name: `${repo}#${issue.number}`,
      title: issue.title,
      title_link: issue.html_url,
      footer: `opened ${opened}, updated ${updated} by ${issue.user.login}`,
    };
  }

  sendReport(report) {
    const source = report.getUser().slack;
    if (!source.active) {
      return;
    }

    if (!report.hasData()) {
      this.send(source, ':tada: You have no pull requests to review! :beers:');
      return;
    }

    const toReview = report.getPullRequestsToReview();
    if (toReview.length > 0) {
      this.send(source, {
        text: 'Here are pull requests you need to *review*:\n',
        attachments: toReview.map(issue => Slack.createIssueAttachment(issue, { color: '#36a64f' })),
      });
    }

    const toComplete = report.getPullRequestsToComplete();
    if (toComplete.length > 0) {
      this.send(source, {
        text: 'Here are pull requests you need to *handle*:',
        attachments: toComplete.map(issue => Slack.createIssueAttachment(issue, { color: '#F35A00' })),
      });
    }
  }
};
