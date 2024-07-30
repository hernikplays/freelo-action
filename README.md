# Freelo Synchronization GitHub action
This action can be used for a one-way synchronization of GitHub issues into [Freelo](https://freelo.io)

It will log in as a Freelo user and create tasks/subtasks from created issues. Depending on the set up, it can
also update it based on edits made on GitHub (see below).

## How to use
Example action.yml showcasing all supported `on` calls:

```yml
name: Run the action

on:
  workflow_dispatch:
  issues:
    types: [opened, edited, closed, reopened, assigned, unassigned]
  issue_comment:
    types: [created, edited, deleted]
permissions:
  issues: write
jobs:
  run-my-action:
    name: Sync stuff to Freelo
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: hernikplays/freelo-action@v1
        with:
          email: ""
          api-key: ""
          project-id: ""
          task-id: ""
```

> [!WARNING]
> It's okay to omit some of the `on` listening types, but it is needed to keep the `issue.opened` type,
> because it creates the task and the comment to track the task across action runs.

If you want to sync your current repository, run the workflow manually (`workflow_dispatch`). **This will only sync open issues.** Make sure to check the available parameters below.

### Parameters
| Parameter    | Description                                                                                      | Required                    |
|--------------|--------------------------------------------------------------------------------------------------|-----------------------------|
| email        | E-mail used to log into Freelo; will be the author of all tasks/comments created by this action! | Yes                         |
| api-key      | API key to authenticate the user                                                                 | Yes                         |
| project-id   | ID of the project where tasks will be created                                                    | Yes                         |
| github-token | GitHub token used to create issue comments; you should use the default `secrets.GITHUB_TOKEN`    | Yes                         |
| task-id      | ID of the task under which subtasks will be created from issues                                  | If `tasklist-id` is not set |
| tasklist-id  | ID of the tasklist where tasks will be created from issues                                       | If `task-id` is not set     |
| create-tasks-for-unknown  | Whether to create new tasks for issues without a Freelo comment from actions bot; used only when running the workflow manually                  | If `task-id` is not set     |
| manually-sync-new-comments  | Whether to sync new comments when running the workflow manually                  | If `task-id` is not set     |

### Linking GitHub users to Freelo users
The action will look for a `freelo.txt` file inside of your `.github` folder (the one where Action workflows are stored).
In it you can map GitHub usernames to Freelo IDs, one user per line:

```
hernikplays:14832
john_doe:6586
```

If the file cannot be found or cannot be correctly loaded, no mapping will be done and the action will simply use the GitHub username in place of the Freelo ID.

### Security
Because I have not found any documentation on how Freelo handles sanitization of input, I've included the usage of [sanitize-html](https://www.npmjs.com/package/sanitize-html) to sanitize any user input. The only allowed tags are `"a","p","i","b","strong"`.

If you feel like a security issue has been introduced in the code, feel free to [report it](https://github.com/hernikplays/freelo-action/security/advisories/new).

## Contributing
See [CONTRIBUTING.md](https://github.com/hernikplays/freelo-action/blob/main/CONTRIBUTING.md).

## License
```
Copyright 2024 Matyáš Caras

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```