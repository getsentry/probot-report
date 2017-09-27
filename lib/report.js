const _ = require('lodash');

module.exports = class Report {
  constructor(data) {
    this.data = data;
  }

  hasData() {
    if (_.get(this.data, 'pullRequests.toReview', []).length > 0) return true;
    if (_.get(this.data, 'pullRequests.toComplete', []).length > 0) return true;
    return false;
  }

  addPullRequests(pullRequests) {
    this.data = { ...this.data, pullRequests };
    return this;
  }

  getPullRequestsToReview() {
    return _.sortBy(_.get(this.data, 'pullRequests.toReview', []), pr => pr.created_at);
  }

  getPullRequestsToComplete() {
    return _.sortBy(_.get(this.data, 'pullRequests.toComplete', []), pr => pr.created_at);
  }
};
