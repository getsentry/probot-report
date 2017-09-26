const Reporter = require('./reporter');
const Config = require('./config');
const Mailer = require('./mailer');
const Slack = require('./slack');

/**
 * Global registry of reporters for each installation.
 */
const reporters = {};

function sendReport(reporter, user, pullRequests) {
  console.info(`Sending scheduled report to "${user.login}" with ${pullRequests.length} PRs`);

  if (user.email) {
    reporter.mailer.sendReport(user, pullRequests);
  } else {
    console.warn(`No email found for user "${user.login}"`);
  }

  if (user.slack && user.slack.active) {
    reporter.slack.sendReport(user, pullRequests);
  } else {
    const message = user.slack ? 'No slack configuration' : 'Slack disabled';
    console.debug(`${message} for user "${user.login}"`);
  }
}

async function requestReport(reporter, slack, user) {
  console.info(`Sending requested report to "${user.login}"`);
  const pullRequests = await reporter.getPullRequestsForUser(user);
  slack.sendReport(user, pullRequests);
}

function getReporter(context) {
  const { owner } = context.repo();
  return reporters[owner].reporter;
}

async function addReporter(github, installation) {
  const id = installation.account.login;
  console.info(`Adding reporter for account "${id}"`);

  if (reporters[id] == null) {
    const config = await new Config(github, installation.account).load();
    const mailer = new Mailer(config.get().email);
    const reporter = new Reporter(github, installation, config)
      .onReport((user, prs) => sendReport(reporters[id], user, prs));
    const slack = new Slack(config)
      .onRequestReport(async user => requestReport(reporter, slack, user));
    reporters[id] = { config, mailer, reporter, slack };
  } else {
    console.warn(`Reporter for account "${id}" had already been added`);
  }
}

function removeReporter(installation) {
  const id = installation.account.login;
  console.info(`Removing reporter for account "${id}"`);

  const reporter = reporters[id];
  if (reporter) {
    reporter.reporter.teardown();
    reporter.slack.teardown();
    delete reporters[id];
  } else {
    console.warn(`There is no reporter for account "${id}"`);
  }
}

async function setupRobot(robot) {
  console.info('Report plugin starting up');
  const github = await robot.auth();

  github.paginate(github.apps.getInstallations({ per_page: 100 }), (result) => {
    console.debug(`Initializing ${result.data.length} installations...`);
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
