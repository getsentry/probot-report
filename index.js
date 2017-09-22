const Reporter = require('./lib/reporter');
const Config = require('./lib/config');

/**
 * Global registry of reporters for each installation.
 */
const reporters = {};

function getReporter(context) {
  const { owner } = context.repo();
  return reporters[owner];
}

async function addReporter(github, installation) {
  const id = installation.account.login;
  if (reporters[id] == null) {
    const config = await Config.loadConfig(github, installation.account);
    Config.writeConfig(github, installation.account, config);
    reporters[id] = new Reporter(github, installation, config);
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
