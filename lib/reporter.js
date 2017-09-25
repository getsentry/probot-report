const EventEmitter = require('events');
const isEqual = require('lodash/isEqual');
const moment = require('moment');
const schedule = require('node-schedule');

/**
 * Installation target type: User
 */
const TYPE_USER = 'User';

/**
 * Installation target type: Organization
 */
const TYPE_ORGANIZATION = 'Organization';

/**
 * Event emitted when generating reports
 */
const EVENT_REPORT = 'report';

module.exports = class Reporter {
  constructor(github, installation, config) {
    this.github = github;
    this.installation = installation;
    this.config = config;

    this.emitter = new EventEmitter();
    this.users = {};
    this.jobs = {};

    this.setupUsers();
  }

  onReport(callback) {
    this.emitter.on(EVENT_REPORT, callback);
    return this;
  }

  async getDetailsFor(user) {
    const response = await this.github.users.getById({ id: user.id });
    return response.data;
  }

  async getLastCommitForUser(user) {
    const login = user.login.toLowerCase();

    const params = {
      q: `committer:${login}`,
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
      return this.config.get().defaultTimezone;
    }

    const committerDate = commit.committer.date;
    return moment.parseZone(committerDate).utcOffset();
  }

  isStale(pullRequest) {
    const updatedAt = moment(new Date(pullRequest.updated_at));
    return moment()
      .subtract(this.config.get().daysUntilStale, 'days')
      .isSameOrAfter(updatedAt);
  }

  getPullRequestsForUser(user) {
    const login = user.login.toLowerCase();
    const query = `is:pr is:open review-requested:${login}`;
    const request = this.github.search.issues({ q: query, per_page: 100 });
    return this.github.paginate(request, response => response.data.items
      .filter(pr => this.isStale(pr)));
  }

  async sendReport(user) {
    const pullRequests = await this.getPullRequestsForUser(user);
    if (pullRequests.length > 0) {
      this.emitter.emit(EVENT_REPORT, user, pullRequests);
    }
  }

  scheduleReport(user, time) {
    const date = moment(time, 'HH:mm')
      .utcOffset(user.timezone, true)
      .utcOffset(moment().utcOffset());

    const rule = new schedule.RecurrenceRule(null, null, null, null, date.hour(), date.minute());
    const job = schedule.scheduleJob(rule, () => this.sendReport(user));

    const login = user.login.toLowerCase();
    this.jobs[login].push(job);
  }

  async addUser(user, writeConfig = true) {
    if (user.type !== TYPE_USER) {
      return;
    }

    const login = user.login.toLowerCase();
    if (this.users[login]) {
      return;
    }

    const config = this.config.get();
    const users = config.users;

    // TODO: Update the cached timezone
    let userConfig = users[login];
    if (!userConfig) {
      const [details, timezone] = await Promise.all([
        this.getDetailsFor(user),
        this.getTimeZoneForUser(user),
      ]);

      userConfig = {
        login,
        id: user.id,
        email: details.email,
        timezone,
      };
    }

    this.users[login] = userConfig;
    this.jobs[login] = [];

    if (writeConfig && !isEqual(this.users, users)) {
      this.merge({ users: this.users });
    }

    config.reportTimes.forEach(time => this.scheduleReport(userConfig, time));
  }

  removeUser(user) {
    const login = user.login.toLowerCase();
    const jobs = this.jobs[login];
    if (jobs) {
      jobs.forEach(job => job.cancel());
      delete this.users[login];
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
      console.error(`Unknown installation target type: ${targetType}`);
    }

    if (!isEqual(this.users, this.config.get().users)) {
      this.config.merge({ users: this.users });
    }
  }

  teardown() {
    this.users.forEach(user => this.removeUser(user));
  }
};
