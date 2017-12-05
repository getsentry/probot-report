const _ = require('lodash');

const KEY_PR_REVIEW = 'pullRequestsToReview';
const KEY_PR_COMPLETE = 'pullRequestsToComplete';
const KEY_NEW_ISSUES = 'newIssues';

module.exports = class Report {
  constructor(user) {
    this.user = user;
    this.data = {};
  }

  sort(list, by) {
    const sorted = _.sortBy(list, by);
    return this.user.order === 'desc' ? sorted.reverse() : sorted;
  }

  hasData() {
    return _.some(this.data, list => list.length > 0);
  }

  isEmpty() {
    return !this.hasData();
  }

  count() {
    return _.reduce(this.data, (sum, list) => sum + list.length, 0);
  }

  addPullRequestsToReview(pullRequests) {
    this.data[KEY_PR_REVIEW] = [
      ...(this.data[KEY_PR_REVIEW] || []),
      ...pullRequests,
    ];
    return this;
  }

  addPullRequestsToComplete(pullRequests) {
    this.data[KEY_PR_COMPLETE] = [
      ...(this.data[KEY_PR_COMPLETE] || []),
      ...pullRequests,
    ];
    return this;
  }

  addNewIssues(issues) {
    this.data[KEY_NEW_ISSUES] = [
      ...(this.data[KEY_NEW_ISSUES] || []),
      ...issues,
    ];
    return this;
  }

  getUser() {
    return this.user;
  }

  getPullRequestsToReview() {
    return this.sort(this.data[KEY_PR_REVIEW] || [], pr => pr.created_at);
  }

  getPullRequestsToComplete() {
    return this.sort(this.data[KEY_PR_COMPLETE] || [], pr => pr.created_at);
  }

  // We currently only return 5 random issues, since this potentially can become huge
  getNewIssues() {
    return this.sort(
      _.sampleSize(this.data[KEY_NEW_ISSUES], 5) || [],
      issue => issue.created_at
    );
  }
};
