const moment = require('moment');
const defaults = require('./defaults');

/**
 * Installation target type: User
 */
const TYPE_USER = 'User';

/**
 * Installation target type: Organization
 */
const TYPE_ORGANIZATION = 'Organization';

module.exports = class Reporter {
  constructor(github, installation, config) {
    this.github = github;
    this.installation = installation;
    this.config = { ...defaults, ...config };
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
    return this.github.paginate(request, response => response.data);
    // TODO: Filter PRs by staleness. Check if there is a search query filter for that
  }

  async addUser(user) {
    if (user.type !== TYPE_USER) {
      // TODO: Warn
      return;
    }

    if (this.users[user.id]) {
      return;
    }

    const [details, timezone] = await Promise.all([
      this.getDetailsFor(user),
      this.getTimeZoneForUser(user),
    ]);

    this.users[user.id] = {
      id: user.id,
      login: user.login,
      email: details.email,
      timezone,
    };

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
      // TODO: Looks like addUser is not executed in parallel
      this.github.paginate(request, result => result.data.forEach(user => this.addUser(user)));
    } else if (targetType === TYPE_USER) {
      this.addUser(account);
    } else {
      // TODO: Warn
    }
  }

  teardown() {
    // TODO: Remove schedule for this installation
  }
};
