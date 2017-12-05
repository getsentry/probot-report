# Probot: Report

> a GitHub App built with [probot](https://github.com/probot/probot) that sends
> out periodic reports

![](https://user-images.githubusercontent.com/1433023/32178159-57580bd0-bd8c-11e7-9dfd-995ff69d446b.png)

**Disclaimer: This report Bot is heavily focused on our setup, so in order to
use it you probably need to fork it or help us make it more general purpose.**

## Usage

The bot is activated by the file `.github/report.yml` in the settings
repository. If not configured otherwise, this is the `probot-settings`
repository in your organization.

The file can be empty, or it can override any of these default settings:

```yaml
# Local times at which the bot will send automatic reports
reportTimes:
  - 09:00
  - 12:30
# Timezone offset for all users where the timezone cannot be inferred
# Defaults to PDT (UTC-07:00)
defaultTimezone: -420
# Maximum number of days to report new issues
newIssueDays: 7
# Ignores all issues that match this regular expression in their title
ignoreRegex: "\\bwip\\b"
# Ignores all issues with these lables
ignoreLabels:
  - duplicate
  - wontfix
  - invalid
# Mailer configuration, can be omitted to disable email
email:
  # Name of the email sender
  sender: '"🤖 Eos - Github Bot" <noreply@md.getsentry.com>'
  # E-Mail subject
  subject: "Github needs your attention"
  # Template for the entire email body
  bodyTemplate: >
    Hi <%- user.name %>,
    <%= toReview %>
    <%= toComplete %>
    <%= newIssues %>
  # Template to render a single issue
  issueTemplate: >
    <% _.forEach(issues, function (issue) { %>
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
    <% }) %>
  # Template to format the section of PRs to review
  toReviewTemplate: >
    <p>These pull requests need to be <b>reviewed</b>:</p>
    <ul>
      <%= issues %>
    </ul>
  # Template to format the section of PRs to complete
  toCompleteTemplate: >
    <p>These pull requests need to be <b>handled</b>:</p>
    <ul>
      <%= issues %>
    </ul>
  # Template to format the section of new issues
  newIssuesTemplate: >
    <p>There are issues you could <b>label and assign</b>:</p>
    <ul>
      <%= issues %>
    </ul>
```

## Setup

This Probot app requires authentication tokens and credentials for third party
apps in environment variables. The project contains a template for environment
variables located at `.env.example`. Copy this file to `.env` in the project
root and adjust all environment variables.

### Github App

First, create a GitHub App by following the instructions
[here](https://probot.github.io/docs/deployment/#create-the-github-app). Then,
make sure to download the private key and place it in the root directory of this
application or set it via the `PRIVATE_KEY` environment variable. Finally, set
the following environment variables:

| Name             | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `APP_ID`         | Unique ID of the GitHub App                          |
| `WEBHOOK_SECRET` | Random webhook secret configured during app creation |
| `SETTINGS_REPO`  | **optional**. Repository to store configs in.        |

Within your organization, create a repository to store the configuration file.
If not configured otherwise, it defaults to `probot-settings`.

### Sendgrid mailing

The bot can send report emails to all organization members with configured email
addresses (defaulting to their public email address). This requires a
[Sendgrid](https://sendgrid.com/) account. Once created, configure the API token
as `SENDGRID_TOKEN` environment variable.

Leave this value empty to skip report emails.

### Slack

The bot can connect to a Slack team and send summaries there. To do so, it needs
to be registered as Slack bot. Once it has been created, configure its token in
the `SLACK_TOKEN` environment variable.

Leave this value empty to skip connection to Slack.

### Development

To start the development server, make sure the following environment variables
are set:

| Name        | Description                                       |
| ----------- | ------------------------------------------------- |
| `DRY_RUN`   | Disables actual releases. Set to `true`           |
| `SUBDOMAIN` | Subdomain for localtunnel to receive webhooks     |
| `LOG_LEVEL` | Sets the loggers output verbosity. Set to `debug` |

Then, install dependencies and run the bot with:

```sh
# Install dependencies
yarn

# Run the bot
yarn start

# Run test watchers
yarn test:watch
```

We highly recommend to use VSCode and install the recommended extensions. They
will configure your IDE to match the coding style, invoke auto formatters every
time you save and run tests in the background for you. No need to run the
watchers manually.

### Testing

The bot includes an automated test suite that includes unit tests, linting and
formating checks. Additionally, this command generates a coverage report in
`coverage/`. You can run it with npm:

```sh
yarn test
```

We use [prettier](https://prettier.io/) for auto-formatting and
[eslint](https://eslint.org/) as linter. Both tools can automatically fix most
issues for you. To invoke them, simply run:

```sh
yarn fix
```

## Deployment

If you would like to run your own instance of this app, see the
[docs for deployment](https://probot.github.io/docs/deployment/).

This app requires these **Permissions** for the GitHub App:

* **Repository contents**: Read & write
* **Organization members**: Read-only

Also, the following **Events** need to be subscribed:

* **Push**: Git push to a repository
* **Membership**: Team membership added or removed

Also, make sure all required environment variables are present in the production
environment.
