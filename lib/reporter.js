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
  constructor(robot, installation, config) {
    this.robot = robot;
    this.installation = installation;
    this.config = config;
    this.logger = robot.log;

    this.emitter = new EventEmitter();
    this.users = {};
    this.jobs = {};

    this.setupUsers();
  }

  onReport(callback) {
    this.emitter.on(EVENT_REPORT, callback);
    return this;
  }

  getGithub() {
    return this.robot.auth(this.installation.id);
  }

  async getDetailsFor(github, user) {
    this.logger.debug(`Loading details for user "${user.login}"`);
    const response = await github.users.getById({ id: user.id });
    return response.data;
  }

  async getLastCommitForUser(github, user) {
    const login = user.login.toLowerCase();

    const params = {
      q: `committer:${login}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 1,
    };

    this.logger.debug(`Loading last commit for user "${login}"`);
    const response = await github.search.commits(params);
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
    const github = await this.getGithub();
    const login = user.login.toLowerCase();
    const org = this.installation.account.login;

    // review:none returns all PRs without a review
    // sadly there is a bug in github that if you commit after
    // someone requested changes, the pr is still reviewed
    // so it will no longer show up whenever someone already reviewed it ever
    const toReview = await github.paginate(
      github.search.issues({
        q: `is:pr is:open review:none review-requested:${login} org:${org}`,
        per_page: 100,
      }),
      response => response.data.items
        .filter(pr => this.isStale(pr)));

    // This query returns all PRs that already have been reviewed
    // and need to be completed by the assignee
    const toComplete = await github.paginate(
      github.search.issues({
        q: `is:pr is:open review:changes_requested assignee:${login} org:${org}`,
        per_page: 100,
      }),
      response => response.data.items);

    return {
      toReview: _.sortBy(toReview, pr => pr.created_at),
      toComplete: _.sortBy(toComplete, pr => pr.created_at),
    };
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

  async addUser(github, user, writeConfig = true) {
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
        this.getDetailsFor(github, user),
        this.getTimeZoneForUser(github, user),
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
    const github = await this.getGithub();

    if (targetType === TYPE_ORGANIZATION) {
      this.logger.debug(`Loading all organization members for "${account.login}"`);
      const request = github.orgs.getMembers({ org: account.login, per_page: 100 });
      const users = await github.paginate(request, result => result.data);

      this.logger.info(`Initializing ${users.length} users for organization "${account.login}"`);
      await Promise.all(users.map(user => this.addUser(github, user, false)));
    } else if (targetType === TYPE_USER) {
      this.logger.info(`Initializing account "${account.login}" as user`);
      await this.addUser(github, account, false);
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
    const { reportTimes, users } = this.config.get();
    if (!_.isEqual(this.users, users)) {
      _.forEach(this.jobs, jobs => jobs.splice(0, Infinity).forEach(job => job.cancel()));
      _.forEach(users, user => reportTimes.forEach(time => this.scheduleReport(user, time)));
    }
  }
};
