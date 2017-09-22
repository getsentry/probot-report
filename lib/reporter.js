const isEqual = require('lodash/isEqual');
const moment = require('moment');
const schedule = require('node-schedule');
const { writeConfig } = require('./config');
const defaults = require('./defaults');
const Mailer = require('./mailer');

/**
 * Installation target type: User
 */
const TYPE_USER = 'User';

/**
 * Installation target type: Organization
 */
const TYPE_ORGANIZATION = 'Organization';

// TODO: Handle config changes
module.exports = class Reporter {
  constructor(github, installation, config) {
    this.github = github;
    this.installation = installation;
    this.config = { ...defaults, ...config };

    this.mailer = new Mailer(this.config.transports.email);
    this.users = {};
    this.jobs = {};

    this.setupUsers();
  }

  async getDetailsFor(user) {
    const response = await this.github.users.getById({ id: user.id });
    return response.data;
  }

  async getLastCommitForUser(user) {
    const params = {
      q: `committer:${user.login}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 1,
    };

    const response = await this.github.search.commits(params);
    const item = response.data.items[0];
    return item && item.commit;
  }

  async getTimeZoneForUser(user) {
    const commit = await this.getLastCommitForUser(user);
    if (!commit) {
      return 0; // TODO: Default timezone offset
    }

    const committerDate = commit.committer.date;
    return moment.parseZone(committerDate).utcOffset();
  }

  getPullRequestsForUser(user) {
    const query = `is:pr is:open review-requested:${user.login}`;
    const request = this.github.search.issues({ q: query, per_page: 100 });
    // TODO: Filter for stale PRs. Check if there is a search query filter for that
    return this.github.paginate(request, response => response.data.items);
  }

  updateConfig(config) {
    writeConfig(this.github, this.installation.account, config);
  }

  async sendReport(user) {
    const pullRequests = await this.getPullRequestsForUser(user);
    if (pullRequests.length === 0) {
      return;
    }

    // TODO: DRY RUN

    if (user.email) {
      this.mailer.send(user, pullRequests);
    }

    // TODO: Send slack here
  }

  scheduleReport(user, time) {
    const date = moment(time, 'HH:mm')
      .utcOffset(user.timezone, true)
      .utcOffset(moment().utcOffset());

    const rule = new schedule.RecurrenceRule(null, null, null, null, date.hour(), date.minute());
    const job = schedule.scheduleJob(rule, () => this.sendReport(user));

    this.jobs[user.login].push(job);
  }

  async addUser(user, updateConfig = true) {
    if (user.type !== TYPE_USER) {
      // TODO: Warn
      return;
    }

    if (this.users[user.login]) {
      return;
    }

    // TODO: Update the cached timezone
    let userConfig = this.config.users[user.login];
    if (!userConfig) {
      const [details, timezone] = await Promise.all([
        this.getDetailsFor(user),
        this.getTimeZoneForUser(user),
      ]);

      userConfig = {
        id: user.id,
        login: user.login,
        email: details.email,
        timezone,
      };
    }

    this.users[user.login] = userConfig;
    this.jobs[user.login] = [];

    if (updateConfig && !isEqual(this.users, this.config.users)) {
      this.updateConfig({ ...this.config, users: this.users });
    }

    this.config.times.forEach(time => this.scheduleReport(userConfig, time));
  }

  removeUser(user) {
    const jobs = this.jobs[user.login];
    if (jobs) {
      jobs.forEach(job => job.cancel());
      delete this.users[user.login];
    }
  }

  async setupUsers() {
    const account = this.installation.account;
    const targetType = this.installation.target_type;

    if (targetType === TYPE_ORGANIZATION) {
      const request = this.github.orgs.getMembers({ org: account.login, per_page: 100 });
      const users = await this.github.paginate(request, result => result.data);
      await Promise.all(users.map(user => this.addUser(user, false)));
    } else if (targetType === TYPE_USER) {
      await this.addUser(account, false);
    } else {
      // TODO: Warn
    }

    if (!isEqual(this.users, this.config.users)) {
      this.updateConfig({ ...this.config, users: this.users });
    }
  }

  teardown() {
    this.users.forEach(user => this.removeUser(user));
  }
};
