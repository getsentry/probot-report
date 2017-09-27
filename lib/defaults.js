module.exports = {
  reportTimes: ['09:00', '12:30'],
  defaultTimezone: -420,
  email: {
    sender: '"🤖 Eos - Github Bot" <noreply@md.getsentry.com>',
    subjectTemplate: 'Attention: <%= count %> Pull requests',
    issueTemplate: `<% _.forEach(pullRequests, function (pr) { %>
        <li>
          <b><a href="<%= pr.html_url %>"><%- pr.repository_url.match('[^/]+/[^/]+$')[0] %>#<%- pr.number %></a></b>:
          <%- pr.title %><br />
          <small>
            opened <%- moment(pr.created_at).fromNow() %>,
            updated <%- moment(pr.updated_at).fromNow() %>
            by <a href="<%= pr.user.html_url %>"><%- pr.user.login %></a>
          </small>
        </li>
      <% }) %>`,
    toReviewTemplate: `<p>These pull requests need to be reviewed:</p>
      <ul>
        <%- issues %>
      </ul>`,
    toCompleteTemplate: `<p>These pull requests need to be handled:</p>
      <ul>
        <%- issues %>
      </ul>`,
    bodyTemplate: `Hi <%- user.name %>,
    <%- toReview %>
    <%- toComplete %>`,
  },
  users: {},
};
