const Reporter = require('./reporter');
const Config = require('./config');
const Mailer = require('./mailer');
const Slack = require('./slack');

/**
 * Global registry of reporters for each installation.
 */
const reporters = {};

function sendReport(reporter, user, pullRequests) {
  if (user.email) {
    reporter.mailer.send(user, pullRequests);
  }
  if (user.slack && user.slack.active) {
    reporter.slack.sendPullRequestReminder(user, pullRequests);
  }
}

function getReporter(context) {
  const { owner } = context.repo();
  return reporters[owner].reporter;
}

async function addReporter(github, installation) {
  const id = installation.account.login;
  if (reporters[id] == null) {
    const config = await new Config(github, installation.account).load();
    const mailer = new Mailer(config.get().email);
    const reporter = new Reporter(github, installation, config)
      .onReport((user, prs) => sendReport(reporters[id], user, prs));
    const slack = new Slack(config)
      .onRequestReport(async (user) => {
        const pullRequests = await reporter.getPullRequestsForUser(user);
        slack.sendPullRequestReminder(user, pullRequests);
      });
    reporters[id] = { config, mailer, reporter, slack };
  }
}

function removeReporter(installation) {
  const id = installation.account.login;
  const reporter = reporters[id];
  if (reporter) {
    reporter.reporter.teardown();
    reporter.slack.teardown();
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

  robot.on('push', async (context) => {
    const reporter = getReporter(context);
    if (reporter && (await reporter.config.loadChanges(context))) {
      reporter.reloadUsers();
    }
  });
}

module.exports = setupRobot;