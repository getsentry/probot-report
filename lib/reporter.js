const EventEmitter = require('events');
const _ = require('lodash');
const moment = require('moment');
const schedule = require('node-schedule');
const Report = require('./report');
const { filterAsync, rateLimit } = require('./utils');

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

/**
 * Allowed search requests per minute
 * TODO: Retrieve this value via GitHub API
 */
const SEARCH_RATE = 25;

/**
 * Cache duration for issues in minutes
 */
const CACHE_ISSUES = 10;

/**
 * Cache duration for watchers in minutes
 */
const CACHE_WATCHERS = 1440; // 1 day

module.exports = class Reporter {
  constructor(robot, installation, config) {
    this.robot = robot;
    this.installation = installation;
    this.config = config;
    this.logger = robot.log;

    this.emitter = new EventEmitter();
    this.loadedUsers = {};
    this.jobs = {};
    this.watchers = {};

    this.searchIssuesRateLimited = rateLimit(
      this.searchIssues,
      1000 * (60 / SEARCH_RATE)
    );

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

  async getTimeZoneForUser(github, user) {
    const commit = await this.getLastCommitForUser(github, user);
    if (!commit) {
      this.logger.debug(
        `Did not find commits for user "${user.login}, using default timezone`
      );
      return this.config.get().defaultTimezone;
    }

    const committerDate = commit.committer.date;
    return moment.parseZone(committerDate).utcOffset();
  }

  isIgnored(issue) {
    const { ignoreRegex, ignoreLabels } = this.config.get();
    if (new RegExp(ignoreRegex, 'i').test(issue.title)) {
      return true;
    }

    if (issue.labels.some(label => ignoreLabels.includes(label.name))) {
      return true;
    }

    return false;
  }

  searchIssues(github, query) {
    return github.paginate(
      github.search.issues({
        q: `org:${this.installation.account.login} ${query}`,
        per_page: 100,
      }),
      response => response.data.items.filter(issue => !this.isIgnored(issue))
    );
  }

  async getNewIssues(github) {
    if (this.newIssues) {
      return this.newIssues;
    }

    // Look for all public issues that haven't been assigned or labeled yet
    // We should also filter out issues with comments from organization members
    const date = moment()
      .subtract(this.config.get().newIssueDays, 'days')
      .format('YYYY-MM-DD');
    this.newIssues = this.searchIssuesRateLimited(
      github,
      `is:open is:issue is:public no:assignee no:label created:>=${date}`
    );

    // Automatically clear the issues cache when the timeout expires
    setTimeout(() => {
      this.newIssues = null;
    }, CACHE_ISSUES * 60 * 1000);
    return this.newIssues;
  }

  async getWatchers(github, repo) {
    if (this.watchers[repo]) {
      return this.watchers[repo];
    }

    const owner = this.installation.account.login;
    this.logger.debug(`Loading watchers for ${owner}/${repo}`);
    const request = github.activity.getWatchersForRepo({
      owner,
      repo,
      per_page: 100,
    });
    this.watchers[repo] = github.paginate(request, response =>
      response.data.map(user => user.login)
    );

    // Automatically clear the watcher cache when the timeout expires
    setTimeout(() => {
      delete this.watchers[repo];
    }, CACHE_WATCHERS * 60 * 1000);
    return this.watchers[repo];
  }

  async isInWatchedRepo(github, issue, user) {
    // Since the issue doesn't include repository information, we need to parse it
    const repo = /[^/]+$/.exec(issue.repository_url);
    if (repo == null) {
      return false;
    }

    const watchers = await this.getWatchers(github, repo[0]);
    return watchers.includes(user.login);
  }

  async getReportForUser(user) {
    const github = await this.getGithub();
    const login = user.login.toLowerCase();

    // review:none returns all PRs without a review
    // sadly there is a bug in github that if you commit after
    // someone requested changes, the pr is still reviewed
    // so it will no longer show up whenever someone already reviewed it ever
    const toReview = await this.searchIssuesRateLimited(
      github,
      `is:open is:pr review:none review-requested:${login} -assignee:${login} -author:${login}`
    );

    // This query returns all PRs that already have been reviewed
    // and need to be completed by the assignee
    const toComplete = await this.searchIssuesRateLimited(
      github,
      `is:open is:pr -review:none assignee:${login}`
    );

    // Look for all public issues that haven't been handled yet
    const newIssues = await filterAsync(
      await this.getNewIssues(github),
      issue => this.isInWatchedRepo(github, issue, user)
    );

    // We can pull this out of here when we have issue or stuff we query
    // for now leave it here
    return new Report(user)
      .addPullRequestsToReview(toReview)
      .addPullRequestsToComplete(toComplete)
      .addNewIssues(newIssues);
  }

  async sendReport(user) {
    this.logger.info(`Generating report for user "${user.login}"...`);
    const report = await this.getReportForUser(user);

    if (report.hasData()) {
      const weekday = moment()
        .utcOffset(user.timezone)
        .isoWeekday();
      // if current time of user is a weekday
      // we actually send the report
      if (weekday <= 5) {
        this.emitter.emit(EVENT_REPORT, user, report);
      } else {
        this.logger.debug('Skipping report due to user time is not a weekday');
      }
    } else {
      this.logger.debug(
        `Skipping report for "${user.login}", no pull requests found`
      );
    }
  }

  scheduleReport(user, time) {
    if (user.enabled === false) {
      return;
    }

    const login = user.login.toLowerCase();
    if (this.jobs[login] == null) {
      this.jobs[login] = [];
    }

    const date = moment(time, 'HH:mm')
      .utcOffset(user.timezone, true)
      .utcOffset(moment().utcOffset());

    const rule = new schedule.RecurrenceRule(
      null,
      null,
      null,
      null,
      date.hour(),
      date.minute()
    );
    const job = schedule.scheduleJob(rule, () => this.sendReport(user));
    this.logger.debug(
      `Scheduled job for "${user.login}" job: ${rule.nextInvocationDate()}`
    );

    this.jobs[login].push(job);
  }

  async addUser(github, user, writeConfig = true) {
    if (user.type !== TYPE_USER) {
      return;
    }

    const login = user.login.toLowerCase();
    if (this.loadedUsers[login]) {
      // This user has already been loaded and scheduled
      return;
    }

    const config = this.config.get();

    // TODO: Update the cached timezone
    const userConfig =
      config.users[login] || (await this.getUser(github, user));
    this.loadedUsers[login] = userConfig;

    if (writeConfig && !_.isEqual(this.loadedUsers, config.users)) {
      this.config.merge({ users: this.loadedUsers });
    }

    config.reportTimes.forEach(time => this.scheduleReport(userConfig, time));
  }

  async getUser(github, user) {
    const login = user.login.toLowerCase();
    this.logger.info(
      `Found new user "${login}", fetching details and timezone`
    );
    const [details, timezone] = await Promise.all([
      this.getDetailsFor(github, user),
      this.getTimeZoneForUser(github, user),
    ]);

    return {
      login,
      id: user.id,
      email: details.email,
      name: user.name || user.login,
      timezone,
    };
  }

  removeUser(user) {
    const login = user.login.toLowerCase();
    const jobs = this.jobs[login] || [];
    if (jobs.length > 0) {
      jobs.forEach(job => job.cancel());
      delete this.loadedUsers[login];
    }
  }

  async setupUsers() {
    const { account } = this.installation;
    const targetType = this.installation.target_type;
    const github = await this.getGithub();

    if (targetType === TYPE_ORGANIZATION) {
      this.logger.debug(
        `Loading all organization members for "${account.login}"`
      );
      const request = github.orgs.getMembers({
        org: account.login,
        per_page: 100,
      });
      const users = await github.paginate(request, result => result.data);

      this.logger.info(
        `Initializing ${users.length} users for organization "${account.login}"`
      );
      await Promise.all(users.map(user => this.addUser(github, user, false)));
    } else if (targetType === TYPE_USER) {
      this.logger.info(`Initializing account "${account.login}" as user`);
      await this.addUser(github, account, false);
    } else {
      this.logger.error(`Unknown installation target type: ${targetType}`);
    }

    if (!_.isEqual(this.loadedUsers, this.config.get().users)) {
      this.config.merge({ users: this.loadedUsers });
    }
  }

  teardown() {
    _.forEach(this.loadedUsers, user => this.removeUser(user));
  }

  reloadUsers() {
    const { reportTimes, users } = this.config.get();
    if (!_.isEqual(this.loadedUsers, users)) {
      _.forEach(this.jobs, jobs =>
        jobs.splice(0, Infinity).forEach(job => job.cancel())
      );
      _.forEach(users, user =>
        reportTimes.forEach(time => this.scheduleReport(user, time))
      );
    }
  }
};
