import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import axios from "axios";
import sanitize from "sanitize-html";
import type { NewTask } from "./freelo";
import { readFile } from "node:fs/promises";

// user input
const email = getInput("email");
const apiKey = getInput("api-key");
const projectId = getInput("project-id");
const taskId = getInput("task-id");
const tasklistId = getInput("tasklist-id");
const token = getInput("github-token");

if (!token) {
	setFailed("No GitHub token passed");
	throw new Error("No GitHub token passed");
}

// values from action
const octokit = getOctokit(token);
const action = context.payload.action;
const issue = context.payload.issue;
const comment = context.payload.comment;

// constants
const apiEndpoint = "https://api.freelo.io/v1";
const defaultHeaders = {
	"User-Agent": "Freelo GitHub Action/1.0.0",
	"Content-Type": "application/json",
};
const sanitizeOptions: sanitize.IOptions = {
	allowedTags: ["a", "p", "i", "b", "strong"],
	allowedAttributes: false,
};

try {
	if (!action) {
		throw new Error("No action was passed");
	}
	if (!email || !apiKey || !projectId) {
		throw new Error(
			"You are missing a required parameter. Check the documentation for details.",
		);
	}
	if (issue) {
		// is a created/edited/closed etc. issue
		if (issue.pull_request) {
			throw new Error("Pull requests are not yet supported");
		}

		// depending on whether taskId or tasklistId is set, do something
		if (!tasklistId && !taskId) {
			throw new Error("Either task-id or tasklist-id needs to be set!");
		}

		// Load GitHub:Freelo pairing if available
		let userPairing: string[] | undefined;
		try {
			userPairing = (await readFile("./.github/freelo.txt",{encoding:"utf-8"})).split("\n");
		} catch (e) {
			console.log("No freelo.txt found in .github folder, skipping");
		}

		if (tasklistId) {
			switch (action) {
				case "opened": {
					// New issue has been created, create a task in tasklist
					const author =
						userPairing &&
						userPairing.filter((u) => u.includes(issue.user.login)).length > 0
							? `<div><span data-freelo-mention="1" data-freelo-user-id="${userPairing.filter((u) => u.includes(issue.user.login))[0].split(":")[1]}">@${issue.user.login}</span></div>`
							: `<a href="https://github.com/${issue.user.login}">${issue.user.login}</a>`;
                    console.log(userPairing?.filter((u) => u.includes(issue.user.login)).length)
					const taskComment = `
                Created by: ${author}<br>
                Description: ${sanitize(issue.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.url}">#${issue.number}</a><br>
                <i>(This action was performed automatically)</i>
                `;

					const taskContent: NewTask = {
						name: issue.title,
						comment: {
							content: taskComment,
						},
					}; // TODO: assignee

					const res = await axios.post(
						`${apiEndpoint}/project/${projectId}/tasklist/${tasklistId}/tasks`,
						taskContent,
						{
							headers: defaultHeaders,
							auth: {
								username: email,
								password: apiKey,
							},
						},
					);

					// handle potential error response
					if (res.status > 399) {
						console.error(res.data);
						throw new Error("Got an error response from Freelo API");
					}

					// create an issue comment so we can track if the task has been already created
					octokit.rest.issues.createComment({
						issue_number: issue.number,
						owner: context.payload.repository?.owner.login ?? "",
						repo: context.payload.repository?.name ?? "",
						body: `Freelo task assigned: <a href="https://app.freelo.io/task/${res.data.id}">${res.data.id}</a><br>Please do not edit or delete this comment as it is used to prevent duplication of tasks.`,
					});
					break;
				}

				case "edited":
					break;
				case "closed":
					break;
				case "reopened":
					break;
				case "assigned":
					break;
				case "unassigned":
					break;

				default:
					throw new Error("Unknown action passed");
			}
		}
	} else if (comment) {
		// should be an issue comment
	} else {
		throw new Error(
			"You are running this action through an unsupported trigger",
		);
	}
} catch (error) {
	setFailed((error as Error)?.message ?? "Unknown error");
}
