const _ = require('lodash');

const KEY_PR_REVIEW = 'pullRequestsToReview';
const KEY_PR_COMPLETE = 'pullRequestsToComplete';

module.exports = class Report {
  constructor(user) {
    this.user = user;
    this.data = {};
  }

  sort(list, by) {
    const sorted = _.sortBy(list, by);
    return (this.user.order === 'desc')
      ? sorted.reverse()
      : sorted;
  }

  hasData() {
    return _.some(this.data, list => list.length > 0);
  }

  isEmpty() {
    return !this.hasData();
  }

  addPullRequestsToReview(pullRequests) {
    this.data[KEY_PR_REVIEW] = [...this.data[KEY_PR_REVIEW] || [], ...pullRequests];
    return this;
  }

  addPullRequestsToComplete(pullRequests) {
    this.data[KEY_PR_COMPLETE] = [...this.data[KEY_PR_COMPLETE] || [], ...pullRequests];
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
};
