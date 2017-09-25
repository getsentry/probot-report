module.exports = {
  daysUntilStale: 0,
  reportTimes: ['09:00', '12:30'],
  defaultTimezone: -420,
  email: {
    sender: '"🤖 Eos - Github Bot" <noreply@md.getsentry.com>',
    subjectTemplate: 'Attention: <%= count %> Pending Reviews',
    bodyTemplate: `Hi <%- user.name %>,
      <p>These pull requests require your attention:</p>
      <ul>
        <% _.forEach(pullRequests, function (pr) { %>
          <li>
            <b><a href="<%= pr.html_url %>"><%- pr.repository_url.match('[^/]+/[^/]+$')[0] %>#<%- pr.number %></a></b>:
            <%- pr.title %><br />
            <small>
              updated <%- moment(pr.updated_at).fromNow() %>,
              opened <%- moment(pr.created_at).fromNow() %>
              by <a href="<%= pr.user.html_url %>"><%- pr.user.login %></a>
            </small>
          </li>
        <% }) %>
      </ul>
      <p>Please take some time to review them.</p>`,
  },
  users: {},
};
