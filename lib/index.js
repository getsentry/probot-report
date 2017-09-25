const Reporter = require('./reporter');
const ConfigManager = require('./configManager');
const Mailer = require('./mailer');
const Slack = require('./slack');

/**
 * Global registry of reporters for each installation.
 */
const reporters = {};

let slack = null;

function sendReport(mailer, user, pullRequests) {
  // TODO: DRY RUN
  // TODO: Send slack here

  if (user.email) {
    mailer.send(user, pullRequests);
  }
}

function getReporter(context) {
  const { owner } = context.repo();
  return reporters[owner];
}

async function addReporter(github, installation) {
  const id = installation.account.login;
  if (reporters[id] == null) {
    const configManager = new ConfigManager(github, installation.account);
    const config = await configManager.load();
    slack = new Slack()
      .onReceivedGithubProfile(
        (githubProfile, slackUserInfo) => configManager.updateUser(githubProfile, { slack: slackUserInfo }),
      );
    const mailer = new Mailer(config.transports.email);
    reporters[id] = new Reporter(github, installation, config)
      .onConfigChange(newConfig => configManager.writeConfig(newConfig))
      .onReport((user, prs) => sendReport(mailer, user, prs));
  }
}

function removeReporter(installation) {
  const id = installation.account.login;
  const reporter = reporters[id];
  if (reporter) {
    reporter.teardown();
    delete reporters[id];
  }
}

async function setupRobot(robot) {
  const github = await robot.auth();

  github.paginate(github.apps.getInstallations({ per_page: 100 }), (result) => {
    result.data.forEach(async (installation) => {
      const installationGithub = await robot.auth(installation.id);
      addReporter(installationGithub, installation);
    });
  });

  robot.on('installation.created', (context) => {
    addReporter(context.github, context.payload.installation);
  });

  robot.on('installation.deleted', (context) => {
    removeReporter(context.payload.installation);
  });

  robot.on('member.added', (context) => {
    const reporter = getReporter(context);
    if (reporter) {
      reporter.addUser(context.payload.member);
    }
  });

  robot.on('member.removed', (context) => {
    const reporter = getReporter(context);
    if (reporter) {
      reporter.removeUser(context.payload.member);
    }
  });
}

module.exports = setupRobot;
