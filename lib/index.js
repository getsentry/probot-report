const Reporter = require('./reporter');
const Config = require('./config');
const Mailer = require('./mailer');
const Slack = require('./slack');

/**
 * Global registry of reporters for each installation.
 */
const reporters = {};

/**
 * Logger obtained from probot.
 */
let logger;

function sendReport(reporter, user, pullRequests) {
  logger.info(`Sending scheduled report to "${user.login}" with ${pullRequests.length} PRs`);

  if (user.email) {
    reporter.mailer.sendReport(user, pullRequests);
  } else {
    logger.warn(`No email found for user "${user.login}"`);
  }

  if (user.slack && user.slack.active) {
    reporter.slack.sendReport(user, pullRequests);
  } else {
    const message = user.slack ? 'No slack configuration' : 'Slack disabled';
    logger.debug(`${message} for user "${user.login}"`);
  }
}

async function requestReport(reporter, slack, user) {
  logger.info(`Sending requested report to "${user.login}"`);
  const pullRequests = await reporter.getPullRequestsForUser(user);
  slack.sendReport(user, pullRequests);
}

function getReporter(context) {
  const { owner } = context.repo();
  return reporters[owner].reporter;
}

async function addReporter(robot, installation) {
  const id = installation.account.login;
  logger.info(`Adding reporter for account "${id}"`);

  if (reporters[id] == null) {
    const config = await new Config(robot, installation).load();
    const mailer = new Mailer(config, logger);
    const reporter = new Reporter(robot, installation, config)
      .onReport((user, pullRequests) => sendReport(reporters[id], user, pullRequests));
    const slack = new Slack(config, logger)
      .onRequestReport(async user => requestReport(reporter, slack, user));
    reporters[id] = { config, mailer, reporter, slack };
  } else {
    logger.warn(`Reporter for account "${id}" had already been added`);
  }
}

function removeReporter(installation) {
  const id = installation.account.login;
  logger.info(`Removing reporter for account "${id}"`);

  const reporter = reporters[id];
  if (reporter) {
    reporter.reporter.teardown();
    reporter.slack.teardown();
    delete reporters[id];
  } else {
    logger.warn(`There is no reporter for account "${id}"`);
  }
}

async function setupRobot(robot) {
  logger = robot.log;
  logger.info('Report plugin starting up');
  const github = await robot.auth();

  github.paginate(github.apps.getInstallations({ per_page: 100 }), (result) => {
    logger.debug(`Initializing ${result.data.length} installations...`);
    result.data.forEach(installation => addReporter(robot, installation));
  });

  robot.on('installation.created', (context) => {
    addReporter(robot, context.payload.installation);
  });

  robot.on('installation.deleted', (context) => {
    removeReporter(context.payload.installation);
  });

  robot.on('member.added', (context) => {
    const reporter = getReporter(context);
    if (reporter) {
      reporter.addUser(context.github, context.payload.member);
    }
  });

  robot.on('member.removed', (context) => {
    const reporter = getReporter(context);
    if (reporter) {
      reporter.removeUser(context.github, context.payload.member);
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
