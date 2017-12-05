module.exports = {
  reportTimes: ['09:00', '12:30'],
  defaultTimezone: -420,
  newIssueDays: 7,
  ignoreRegex: '\\bwip\\b',
  ignoreLabels: ['duplicate', 'wontfix', 'invalid'],
  email: {
    sender: '"🤖 Eos - Github Bot" <noreply@md.getsentry.com>',
    subject: 'Github needs your attention',
    issueTemplate: `<% _.forEach(issues, function (issue) { %>
        <li>
          <b><a href="<%= issue.html_url %>">
            <%- issue.repository_url.match('[^/]+/[^/]+$')[0] %>#<%- issue.number %>
          </a></b>:
          <%- issue.title %><br />
          <small>
            opened <%- moment(issue.created_at).fromNow() %>,
            updated <%- moment(issue.updated_at).fromNow() %>
            by <a href="<%= issue.user.html_url %>"><%- issue.user.login %></a>
          </small>
        </li>
      <% }) %>`,
    toReviewTemplate: `<p>These pull requests need to be <b>reviewed</b>:</p>
      <ul>
        <%= issues %>
      </ul>`,
    toCompleteTemplate: `<p>These pull requests need to be <b>handled</b>:</p>
      <ul>
        <%= issues %>
      </ul>`,
    newIssuesTemplate: `<p>There are issues you could <b>label and assign</b>:</p>
      <ul>
        <%= issues %>
      </ul>`,
    bodyTemplate: `Hi <%- user.name %>,
      <%= toReview %>
      <%= toComplete %>
      <%= newIssues %>`,
  },
  users: {},
};
