const yaml = require('js-yaml');

/**
 * Installation target type: User
 */
const TYPE_USER = 'User';

/**
 * Installation target type: Organization
 */
const TYPE_ORGANIZATION = 'Organization';

class Reporter {
  constructor(github, installation) {
    this.github = github;
    this.installation = installation;
    //this.setupUsers();
    this.setupConfig();
  }

  async setupConfig() {
    this.config = await this.getConfig({
      owner: 'getsentry',
      repo: 'sentry-probot',
    });
    this.config = Object.assign({}, require('./defaults'), this.config);
    console.log(this.config);
    // TODO(hazat): This is async so we don't have to config right away
  }

  async getConfig(configRepo) {
    try {
      const res = await this.github.repos.getContent({
        owner: configRepo.owner,
        repo: configRepo.repo,
        path: '.github/config.yml',
      });
      const config = yaml.safeLoad(Buffer.from(res.data.content, 'base64').toString()) || {};
      return Object.assign({}, config);
    } catch (err) {
      // TODO(hazat): Throw error
    }
    return {};
  }

  addUser(user) {
    if (user.type !== TYPE_USER) {
      return;
    }

    this.users[user.id] = {
      id: user.id,
      login: user.login,
    };

    // TODO: Get and update email addresses
    // TODO: Get and update timezone
    // TODO: Get notification schedule
    // TODO: Schedule notifications for this user
  }

  removeUser(user) {
    // TODO: Remove scheduled notifications
    delete this.users[user.id];
  }

  setupUsers() {
    this.users = {};

    const account = this.installation.account;
    const targetType = this.installation.target_type;

    if (targetType === TYPE_ORGANIZATION) {
      const request = this.github.orgs.getMembers({ org: account.login, per_page: 100 });
      this.github.paginate(request, result => result.data.forEach(user => this.addUser(user)));
    } else if (targetType === TYPE_USER) {
      this.addUser(account);
    } else {
      // TODO: Log a warning
    }
  }

  getPullRequestsByUser(user) {
    const query = `is:pr is:open review-requested:${user.login}`;
    const request = this.github.search.issues({ q: query, per_page: 100 });
    return this.github.paginate(request, response => response.data);
    // TODO: Filter PRs by staleness. Check if there is a search query filter for that
  }

  teardown() {
    // TODO: Remove schedule for this installation
  }
}

const reporters = {};

async function addInstallation(github, installation) {
  const id = installation.account.id;
  if (reporters[id] == null) {
    reporters[id] = new Reporter(github, installation);
  }
}

async function removeInstallation(installation) {
  const id = installation.account.id;
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
      addInstallation(installationGithub, installation);
    });
  });

  robot.on('installation.created', async (context) => {
    addInstallation(context.github, context.payload.installation);
  });

  robot.on('installation.deleted', async (context) => {
    removeInstallation(context.payload.installation);
  });

  // TODO(ja): Listen for new PR review requests...
}

module.exports = setupRobot;
