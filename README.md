# Freelo Synchronization GitHub action
This action can be used for a one-way synchronization of GitHub issues into [Freelo](https://freelo.io)

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

### Linking GitHub users to Freelo users
The action will look for a `freelo.txt` file inside of your `.github` folder (the one where Action workflows are stored).
In it you can map GitHub usernames to Freelo IDs, one user per line:

```
hernikplays:14832
john_doe:6586
```

If the file cannot be found, no mapping will be done and the action will simply put the GitHub username in the task description.
In case the file is not formatted correctly or another error occures, the action will throw an error.

### Security
Because I have not found any documentation on how Freelo handles sanitization of input, I've included the usage of [sanitize-html](https://www.npmjs.com/package/sanitize-html) to sanitize any user input. The only allowed tags are `"a","p","i","b","strong"`

## License
```
Copyright 2024 Matyáš Caras

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```