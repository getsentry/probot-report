module.exports = {
  transports: {
    email: {
      sender: '"🤖 Sentry Bot" <noreply@md.getsentry.com>',
      templates: {
        item: `
          <li>
            <b><a href="<%= pr.html_url %>"><%- repo %>#<%- pr.number %></a></b>:
            <%- pr.title %><br />
            <small>
              updated <%= moment(pr.updated_at).fromNow() %>,
              opened <%= moment(pr.created_at).fromNow() %>
              by <a href="<%= pr.user.html_url %>"><%- pr.user.login %></a>
            </small>
          </li>`,
        message: `Hi <%- userName %>,
          <p>These pull requests require your attention:</p>
          <ul>
            <%= items %>
          </ul>
          <p>Please take some time to review them.</p>`,
        subject: 'PR Summary: <%= count %> reviews waiting',
      },
    },
  },
  users: {},
  times: [
    '09:00',
    '12:30',
  ],
};
