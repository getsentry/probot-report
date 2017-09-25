const _ = require('lodash');
const Botkit = require('botkit');
const EventEmitter = require('events');

/**
 * Event emitted when generating reports
 */
const EVENT_REQUEST_REPORT = 'slack.request.report';

module.exports = class Slack {
  constructor(config) {
    this.config = config;

    this.emitter = new EventEmitter();
    this.controller = Botkit.slackbot({ debug: true });
    this.bot = this.controller.spawn({ token: process.env.SLACK_TOKEN });

    this.startRtm();
    this.setupCallbacks();
  }

  teardown() {
    this.bot.closeRTM();
  }

  startRtm() {
    this.bot.startRTM((err) => {
      if (err) {
        console.log('Failed to start RTM');
        setTimeout(this.startRtm, 60000);
      } else {
        console.log('RTM started!');
      }
    });
  }

  onRequestReport(callback) {
    this.emitter.on(EVENT_REQUEST_REPORT, callback);
    return this;
  }

  isUserConnectedToSlack(message) {
    const users = this.config.get().users;
    let userFound = null;
    _.forEach(users, (user) => {
      if (user.slack !== undefined && user.slack.user === message.user) {
        userFound = user;
      }
    });
    return userFound;
  }

  static postHelp(bot, message) {
    bot.whisper(message,
      'Greetings! :flag-au:\n Here are a few commands to run:\n' +
      ':one: `list` _lists your PRs on github to review_\n' +
      ':two: `slack on` / `slack off` _toggle notifications via slack_\n' +
      ':three: `update email <email>` _update your email address_\n' +
      ':four: `get config` _list the config for your user_\n' +
      '',
    );
  }

  setupCallbacks() {
    // Automatically restore the connection when it drops
    this.controller.on('rtm_close', () => this.startRtm());

    this.controller.on('direct_message', (bot, message) => {
      const user = this.isUserConnectedToSlack(message);
      if (user !== null) {
        const emailMatch = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}\b/gi.exec(message.text);
        if (message.text === 'slack on') {
          bot.whisper(message, ':white_check_mark: You will now receive notifications via slack.');
          this.config.mergeUser(user.login, { slack: { ...user.slack, active: true } });
        } else if (message.text === 'slack off') {
          bot.whisper(message, ':no_entry_sign: You no longer receive notifications via slack.');
          this.config.mergeUser(user.login, { slack: { ...user.slack, active: false } });
        } else if (message.text === 'get schwifty') {
          bot.whisper(message, 'https://www.youtube.com/watch?v=I1188GO4p1E');
        } else if (message.text === 'list') {
          bot.whisper(message, ':eyes: Gimme a second...');
          this.emitter.emit(EVENT_REQUEST_REPORT, user);
        } else if (emailMatch !== null) {
          bot.whisper(message, `:white_check_mark: Updated email to *${emailMatch[0]}*`);
          this.config.mergeUser(user.login, { email: emailMatch[0] });
        } else if (message.text === 'get config') {
          bot.whisper(message, `\`\`\`\n${JSON.stringify(user, null, 4)}\n\`\`\``);
        } else {
          Slack.postHelp(bot, message);
        }
      } else {
        const githubLoginMatch = /<https:\/\/github\.com\/([^/>]+)\/?>$/g.exec(message.text);
        if (githubLoginMatch !== null) {
          const slack = {
            user: message.user,
            channel: message.channel,
            active: true,
          };
          this.config.mergeUser(githubLoginMatch[1], { slack });
          bot.whisper(message,
            `Ayo *${githubLoginMatch[1]}*, I know who you are now. :heart:`,
          );
          Slack.postHelp(bot, message);
        } else { // else if user not found
          bot.whisper(message,
            'Greetings stranger, to get started I need to identify who you are.\n' +
            'Please paste the url of your Github profile so I can match you to my database. :fine:',
          );
        }
      }
    });
  }

  sendPullRequestReminder(user, pullRequests) {
    if (user.slack.active) {
      if (pullRequests.length === 0) {
        this.bot.whisper(user.slack, ':tada: You have no pull requests to review! :beers:');
      } else {
        const pullRequestMessage = pullRequests
          .map((pullRequest) => {
            const repo = pullRequest.repository_url.match('[^/]+/[^/]+$')[0];
            return `:small_blue_diamond: *${repo}#${pullRequest.number}*: ${pullRequest.title} (${pullRequest.html_url})`;
          })
          .join('\n');
        this.bot.whisper(user.slack,
          `Here are your pull requests to review:\n${pullRequestMessage}`,
        );
      }
    }
  }
};
