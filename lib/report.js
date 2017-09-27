const _ = require('lodash');

const KEY_PR_REVIEW = 'pullRequestsToReview';
const KEY_PR_COMPLETE = 'pullRequestsToComplete';

module.exports = class Report {
  constructor() {
    this.data = {};
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

  getPullRequestsToReview() {
    return _.sortBy(this.data[KEY_PR_REVIEW] || [], pr => pr.created_at);
  }

  getPullRequestsToComplete() {
    return _.sortBy(this.data[KEY_PR_COMPLETE] || [], pr => pr.created_at);
  }
};
