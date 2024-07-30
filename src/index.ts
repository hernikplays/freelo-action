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
const defaultOptions = {
	auth: {
		username: email,
		password: apiKey,
	},
	headers: {
		"User-Agent": "Freelo GitHub Action/1.0.0",
		"Content-Type": "application/json",
	},
};
const sanitizeOptions: sanitize.IOptions = {
	allowedTags: ["a", "p", "i", "b", "strong"],
	allowedAttributes: false,
};

// Load GitHub:Freelo pairing if available
const userPairing: { [key: string]: string } = {};
try {
	for (const u of (
		await readFile("./.github/freelo.txt", { encoding: "utf-8" })
	).split("\n")) {
		const p = u.split(":");
		userPairing[p[0]] = p[1];
	}
} catch (e) {
	console.log("No valid freelo.txt found in .github folder, skipping");
}

function freeloMention(username: string): string {
	return Object.keys(userPairing).includes(username)
		? `<div><span data-freelo-mention="1" data-freelo-user-id="${userPairing[username]}">@${username}</span></div>`
		: `<a href="https://github.com/${username}">${username}</a>`;
}

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

		if (tasklistId) {
			switch (action) {
				case "opened": {
					// New issue has been created, create a task in tasklist
					const taskComment = `
                Created by: ${freeloMention(issue.user.login)}<br>
                Description: ${sanitize(issue.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.url}">#${issue.number}</a><br>
                Assigned to: ${issue.assignee ? `${freeloMention(issue.assignee.login)}` : "Nobody"}<br>
                <i>(This action was performed automatically)</i>
                `;

					const taskContent: NewTask = {
						name: issue.title,
						comment: {
							content: taskComment,
						},
					};

					const res = await axios.post(
						`${apiEndpoint}/project/${projectId}/tasklist/${tasklistId}/tasks`,
						taskContent,
						defaultOptions,
					);

					// handle potential error response
					if (res.status > 399) {
						console.error(res.data);
						throw new Error("Got an error response from Freelo API");
					}

					// create an issue comment so we can track if the task has been already created
					octokit.rest.issues.createComment({
						issue_number: issue.number,
						...context.repo,
						body: `Freelo task assigned: <a href="https://app.freelo.io/task/${res.data.id}">${res.data.id}</a><br>Please do not edit or delete this comment as it is used to prevent duplication of tasks.`,
					});
					break;
				}

				case "edited":
					break;
				case "closed": {
					// Get comments and find the related Freelo task ID
					const comment = (
						await octokit.rest.issues.listComments({
							...context.repo,
							issue_number: issue.number,
							mediaType: {
								format: "html",
							},
						})
					).data.filter(
						(i) => i.user?.type === "Bot" && i.user.login === "github-actions[bot]",
					);
					if (comment.length === 0) break; // not a Freelo task, skip

					// Finish task in Freelo
					const taskId = /https:\/\/app.freelo.io\/task\/(\d+)/.exec(
						comment[0].body_html ?? "",
					);
					if (!taskId || taskId.length === 0) {
						console.log("Comment found, but no Freelo task ID identified");
						break;
					}
					const res = await axios.post(
						`${apiEndpoint}/task/${taskId[1]}/finish`,
						null,
						defaultOptions,
					);

					if (res.status > 399) {
						console.error(res.data);
						throw new Error("Got an error response from Freelo API");
					}
					break;
				}
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
