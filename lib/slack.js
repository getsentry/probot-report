const EventEmitter = require('events');
const Botkit = require('botkit');

/**
 * Event emitted when the config is updated
 */
const SLACK_RECEIVED_GITHUB_PROFILE = 'slack.received.github.profile';

module.exports = class Slack {
  constructor() {
    this.emitter = new EventEmitter();
    this.controller = Botkit.slackbot({ debug: true });
    this.bot = this.controller.spawn({
      token: process.env.SLACK_TOKEN,
    });
    this.startRtm();
    this.setupCallbacks();
  }

  startRtm() {
    this.bot.startRTM((err, bot, payload) => {
      if (err) {
        console.log('Failed to start RTM');
        return setTimeout(this.startRtm, 60000);
      }
      console.log('RTM started!');
    });
  }

  setupCallbacks() {
    this.controller.on('rtm_close', (bot, err) => {
      this.startRtm();
    });

    this.controller.on('direct_message', (bot, message) => {
      // Match for github url
      const githubProfile = /<https:\/\/github\.com\/([^\/>]+)>$/g.exec(message.text);
      if (githubProfile !== null) {
        this.emitter.emit(SLACK_RECEIVED_GITHUB_PROFILE, githubProfile[1].toLowerCase(), {
          user: message.user,
          channel: message.channel,
        });
        bot.whisper(message,
          `Ayo *${githubProfile[1]}*, I know who you are now. :heart:\n` +
          'Now you can write me `email <your email>` to update your email address.\n' +
          'Also you can write `slack on` / `slack off` to receive notifications here.',
        );
      } else if (message.text === 'slack on') {
        bot.whisper(message, ':white_check_mark: You will now receive notifications via slack.');
      } else if (message.text === 'slack off') {
        bot.whisper(message, ':no_entry_sign: You no longer receive notifications via slack.');
      } else if (message.text === 'help') {
        bot.whisper(message, 'Greetings! :flag-au:\n Here are a few commands: :six::four::three:');
      } else { // else if user not found
        bot.whisper(message,
          'Greetings stranger, to get started I need to identify who you are.\n' +
          'Please paste the url of your Github profile so I can match you to my database.',
        );
      }
    });
  }

  onReceivedGithubProfile(callback) {
    this.emitter.on(SLACK_RECEIVED_GITHUB_PROFILE, callback);
    return this;
  }

  sendMessage(slackUserInfo, message) {
    this.bot.whisper(slackUserInfo, message);
  }
};
