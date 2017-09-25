const Botkit = require('botkit');

module.exports = class Slack {
  constructor(config) {
    this.config = config;

    this.controller = Botkit.slackbot({ debug: true });
    this.bot = this.controller.spawn({ token: process.env.SLACK_TOKEN });

    this.startRtm();
    this.setupCallbacks();
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

  mergeUser(githubLogin, profile) {
    const slack = {
      user: profile.user,
      channel: profile.channel,
    };

    this.config.mergeUser(githubLogin.toLowerCase(), { slack });
  }

  setupCallbacks() {
    // Automatically restore the connection when it drops
    this.controller.on('rtm_close', () => this.startRtm());

    this.controller.on('direct_message', (bot, message) => {
      // Match for github url
      const githubLogin = /<https:\/\/github\.com\/([^/>]+)>$/g.exec(message.text);
      if (githubLogin !== null) {
        this.mergeUser(githubLogin[1], message);
        bot.whisper(message,
          `Ayo *${githubLogin[1]}*, I know who you are now. :heart:\n` +
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

  sendMessage(slackUserInfo, message) {
    this.bot.whisper(slackUserInfo, message);
  }
};
