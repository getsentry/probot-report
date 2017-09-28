const Reporter = require('./reporter');
const Config = require('./config');
const Mailer = require('./mailer');
const Slack = require('./slack');

/**
 * Global registry of instances for each installation.
 */
const instances = {};

/**
 * Logger obtained from probot.
 */
let logger;

function sendReport(instance, report) {
  const user = report.getUser();
  logger.info(`Sending scheduled report to "${user.login}"`);
  logger.debug(`Report: ${report}`);

  if (user.email) {
    instance.mailer.sendReport(report);
  } else {
    logger.warn(`No email found for user "${user.login}"`);
  }

  if (user.slack && user.slack.active) {
    instance.slack.sendReport(report);
  } else {
    const message = user.slack ? 'No slack configuration' : 'Slack disabled';
    logger.debug(`${message} for user "${user.login}"`);
  }
}

async function requestMail(instance, user) {
  logger.info(`Sending email report to "${user.login}"`);
  const report = await instance.reporter.getReportForUser(user);
  instance.mailer.sendReport(report);
}

async function requestReport(instance, user) {
  logger.info(`Sending Slack report to "${user.login}"`);
  const report = await instance.reporter.getReportForUser(user);
  instance.slack.sendReport(report);
}

function getReporter(context) {
  const { owner } = context.repo();
  return instances[owner].reporter;
}

async function addReporter(robot, installation) {
  const id = installation.account.login;
  logger.info(`Adding reporter for account "${id}"`);

  if (instances[id] == null) {
    const config = await new Config(robot, installation).load();
    const mailer = new Mailer(config, logger);
    const reporter = new Reporter(robot, installation, config)
      .onReport((user, report) => sendReport(instances[id], report));
    const slack = new Slack(config, logger)
      .onRequestMail(user => requestMail(instances[id], user))
      .onRequestReport(user => requestReport(instances[id], user));
    instances[id] = { config, mailer, reporter, slack };
  } else {
    logger.warn(`Reporter for account "${id}" had already been added`);
  }
}

function removeReporter(installation) {
  const id = installation.account.login;
  logger.info(`Removing reporter instance for account "${id}"`);

  const instance = instances[id];
  if (instance) {
    instance.reporter.teardown();
    instance.slack.teardown();
    delete instances[id];
  } else {
    logger.warn(`There is no reporter instance for account "${id}"`);
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
