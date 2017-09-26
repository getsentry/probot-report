const EventEmitter = require('events');
const _ = require('lodash');
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
  constructor(github, installation, config, logger = console) {
    this.github = github;
    this.installation = installation;
    this.config = config;
    this.logger = logger;

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
      this.logger.debug(`Did not find commits for user "${user.login}, assuming default timezone`);
      return this.config.get().defaultTimezone;
    }

    const committerDate = commit.committer.date;
    return moment.parseZone(committerDate).utcOffset();
  }

  isStale(pullRequest) {
    const updatedAt = moment(new Date(pullRequest.updated_at));
    const { daysUntilStale } = this.config.get();
    return !(daysUntilStale > 0) || moment()
      .subtract(this.config.get().daysUntilStale, 'days')
      .isSameOrAfter(updatedAt);
  }

  async getPullRequestsForUser(user) {
    const login = user.login.toLowerCase();
    const query = `is:pr is:open review-requested:${login}`;
    const request = this.github.search.issues({ q: query, per_page: 100 });
    const pullRequests = await this.github.paginate(request, response => response.data.items
      .filter(pr => this.isStale(pr)));

    return _.sortBy(pullRequests, pr => pr.created_at);
  }

  async sendReport(user) {
    this.logger.info(`Generating report for user "${user.login}"...`);
    const pullRequests = await this.getPullRequestsForUser(user);

    if (pullRequests.length > 0) {
      this.emitter.emit(EVENT_REPORT, user, pullRequests);
    } else {
      this.logger.debug(`Skipping report for "${user.login}", no pull requests found`);
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
      this.logger.info(`Found new user "${login}", fetching details and timezone`);
      const [details, timezone] = await Promise.all([
        this.getDetailsFor(user),
        this.getTimeZoneForUser(user),
      ]);

      if (!details.email) {
        this.logger.warn(`No email found for user "${login}"`);
      }

      userConfig = {
        login,
        id: user.id,
        email: details.email,
        name: user.name || user.login,
        timezone,
      };
    }

    this.users[login] = userConfig;
    this.jobs[login] = [];

    if (writeConfig && !_.isEqual(this.users, users)) {
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
      this.logger.debug(`Loading all organization members for "${account.login}"`);
      const request = this.github.orgs.getMembers({ org: account.login, per_page: 100 });
      const users = await this.github.paginate(request, result => result.data);

      this.logger.info(`Initializing ${users.length} users for organization "${account.login}"`);
      await Promise.all(users.map(user => this.addUser(user, false)));
    } else if (targetType === TYPE_USER) {
      this.logger.info(`Initializing account "${account.login}" as user`);
      await this.addUser(account, false);
    } else {
      this.logger.error(`Unknown installation target type: ${targetType}`);
    }

    if (!_.isEqual(this.users, this.config.get().users)) {
      this.config.merge({ users: this.users });
    }
  }

  teardown() {
    _.forEach(this.users, user => this.removeUser(user));
  }

  reloadUsers() {
    if (!_.isEqual(this.users, this.config.get().users)) {
      this.teardown();
      this.setupUsers();
    }
  }
};
