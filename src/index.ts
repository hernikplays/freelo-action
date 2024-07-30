import { readFile } from "node:fs/promises";
import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import axios from "axios";
import sanitize from "sanitize-html";
import type { Label, NewTask } from "./freelo";

// user input
const email = getInput("email");
const apiKey = getInput("api-key");
const projectId = getInput("project-id");
const taskId = getInput("task-id");
const tasklistId = getInput("tasklist-id");
const token = getInput("github-token");
const createTasks = getInput("create-tasks-for-unknown");
const syncComments = getInput("manually-sync-new-comments")

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

async function freeloId(issue_number: number): Promise<string | undefined> {
	const comment = (
		await octokit.rest.issues.listComments({
			...context.repo,
			issue_number: issue_number,
			mediaType: {
				format: "html",
			},
		})
	).data.filter(
		(i) => i.user?.type === "Bot" && i.user.login === "github-actions[bot]",
	);
	if (comment.length === 0) return undefined; // not a Freelo task, skip

	// Finish task in Freelo
	return /https:\/\/app.freelo.io\/task\/(\d+)/.exec(
		comment[0].body_html ?? "",
	)?.[1];
}

try {
	if (!action) {
		// Check what needs to be synced
		const issues = await octokit.rest.issues.listForRepo({ ...context.repo, state:"open" });
		for (const i of issues.data) {
			const currentTaskId = await freeloId(i.number);
			if (!currentTaskId || currentTaskId.length === 1) {
				console.log(`${i.number} has no Freelo comment`);
				if (!createTasks) {
					continue;
				}
				console.log(`Creating task for ${i.number}`);
				const taskComment = `
                Created by: ${freeloMention(i.user?.login ?? "Unknown")}<br>
                Description: ${sanitize(i.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${i.pull_request ? i.pull_request.url : i.url}">#${i.number}</a><br>
                Assigned to: ${i.assignee ? `${freeloMention(i.assignee.login)}` : "Nobody"}<br>
                ${i.pull_request ? "<b>This is a pull request<b><br>" : ""}
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				const labels: Label[] = [];
				if (i.labels) {
                    for (const label of i.labels) {
                        if(typeof(label) === "string"){
                            labels.push({name:label})
                            continue
                        }
                        if (!label.name) continue;
                        labels.push({
                            name: label.name,
                            color: label.color ?? `#${label.color}`,
                        });
                    }
                }

				const taskContent: NewTask = {
					name: i.title,
					comment: {
						content: taskComment,
					},
					labels,
				};

				const res = await axios.post(
					!taskId
						? `${apiEndpoint}/project/${projectId}/tasklist/${tasklistId}/tasks`
						: `${apiEndpoint}/task/${taskId}/subtasks`,
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
					issue_number: i.number,
					...context.repo,
					body: `Freelo task assigned: <a href="https://app.freelo.io/task/${res.data.id}">${res.data.id}</a><br>Please do not edit or delete this comment as it is used to prevent duplication of tasks.`,
				});
                console.log(`Created task ${res.data.id} in Freelo`)
				continue;
			}

			// Update known tasks
			// Edit task title
			const titleRes = await axios.post(
				`${apiEndpoint}/task/${currentTaskId[1]}`,
				{
					name: i.title,
				},
				defaultOptions,
			);
			if (titleRes.status > 399) {
				console.error(titleRes.data);
				throw new Error("Got an error response from Freelo API");
			}
			const taskComment = `
                Created by: ${freeloMention(i.user?.login ?? "Unknown")}<br>
                Description: ${sanitize(i.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${i.url}">#${i.number}</a><br>
                Assigned to: ${i.assignee ? `${freeloMention(i.assignee.login)}` : "Nobody"}<br>
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

			const labels: Label[] = [];
			if (i.labels) {
                for (const label of i.labels) {
                    if(typeof(label) === "string"){
                        labels.push({name:label})
                        continue
                    }
                    if (!label.name) continue;
                    labels.push({
                        name: label.name,
                        color: label.color ?? `#${label.color}`,
                    });
                }
            }

			// Edit task labels
			const labelRes = await axios.post(
				`${apiEndpoint}/task-labels/add-to-task/${currentTaskId}`,
				{ labels },
				defaultOptions,
			);
			if (labelRes.status > 399) {
				console.error(labelRes.data);
				throw new Error("Got an error response from Freelo API");
			}

			// Edit task body
			const bodyRes = await axios.post(
				`${apiEndpoint}/task/${currentTaskId[1]}/description`,
				{
					comment: { content: taskComment },
					labels,
				},
				defaultOptions,
			);
			if (bodyRes.status > 399) {
				console.error(bodyRes.data);
				throw new Error("Got an error response from Freelo API");
			}

            console.log(`Updated issue ${i.number} in Freelo as ${currentTaskId}`)

            // Sync comments
            if(!syncComments) {
                continue;
            }

            for (const c of (await octokit.rest.issues.listComments({...context.repo,issue_number:i.number})).data) {
                // New comment, add to Freelo task
				const taskComment = `
                Comment <a href="${c.url}">${c.id}</a> by: ${freeloMention(c.user?.login ?? "Unknown")}<br>
                ${sanitize(c.body ?? "Comment not found", sanitizeOptions)}<br>
                GitHub issue: <a href="${i.url}">#${i.number}</a><br>
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				// Create comment
				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId}/comments`,
					{
						content: taskComment,
					},
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				console.log(`Created comment ${res.data.id}`);
            }
		}
	}
	if (!email || !apiKey || !projectId) {
		throw new Error(
			"You are missing a required parameter. Check the documentation for details.",
		);
	}
	if (!comment && issue) {
		// is a created/edited/closed etc. issue

		// depending on whether taskId or tasklistId is set, do something
		if (!tasklistId && !taskId) {
			throw new Error("Either task-id or tasklist-id needs to be set!");
		}

		// Use a task inside of a tasklist
		switch (action) {
			case "opened": {
				// New issue has been created, create a task in tasklist
				const taskComment = `
                Created by: ${freeloMention(issue.user.login)}<br>
                Description: ${sanitize(issue.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.pull_request ? issue.pull_request.url : issue.url}">#${issue.number}</a><br>
                Assigned to: ${issue.assignee ? `${freeloMention(issue.assignee.login)}` : "Nobody"}<br>
                ${issue.pull_request ? "<b>This is a pull request<b><br>" : ""}
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				const labels: Label[] = [];
				if (issue.labels) {
					for (const label of issue.labels) {
						labels.push({ name: label.name, color: `#${label.color}` });
					}
				}

				const taskContent: NewTask = {
					name: issue.title,
					comment: {
						content: taskComment,
					},
					labels,
				};

				const res = await axios.post(
					!taskId
						? `${apiEndpoint}/project/${projectId}/tasklist/${tasklistId}/tasks`
						: `${apiEndpoint}/task/${taskId}/subtasks`,
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

			case "edited": {
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				// Edit task title
				const titleRes = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}`,
					{
						name: issue.title,
					},
					defaultOptions,
				);
				if (titleRes.status > 399) {
					console.error(titleRes.data);
					throw new Error("Got an error response from Freelo API");
				}
				const taskComment = `
                Created by: ${freeloMention(issue.user.login)}<br>
                Description: ${sanitize(issue.body ?? "None", sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.url}">#${issue.number}</a><br>
                Assigned to: ${issue.assignee ? `${freeloMention(issue.assignee.login)}` : "Nobody"}<br>
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				const labels: Label[] = [];
				if (issue.labels) {
					for (const label of issue.labels) {
						labels.push({ name: label.name, color: `#${label.color}` });
					}
				}

				// Edit task labels
				const labelRes = await axios.post(
					`${apiEndpoint}/task-labels/add-to-task/${currentTaskId}`,
					{ labels },
					defaultOptions,
				);
				if (labelRes.status > 399) {
					console.error(labelRes.data);
					throw new Error("Got an error response from Freelo API");
				}

				// Edit task body
				const bodyRes = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}/description`,
					{
						comment: { content: taskComment },
						labels,
					},
					defaultOptions,
				);
				if (bodyRes.status > 399) {
					console.error(bodyRes.data);
					throw new Error("Got an error response from Freelo API");
				}

				break;
			}
			case "closed": {
				// Issue closed, finish task
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("No Freelo task ID identified");
					break;
				}
				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}/finish`,
					null,
					defaultOptions,
				);

				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				break;
			}
			case "reopened": {
				// Issue re-opened, activate task
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("No Freelo task ID identified");
					break;
				}

				// Reactivate
				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}/activate`,
					null,
					defaultOptions,
				);

				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				break;
			}
			case "assigned": {
				// New assignee, check if mapping exists and update in Freelo
				if (
					!context.payload.assignee ||
					!userPairing[context.payload.assignee.login]
				)
					break;
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}`,
					{
						worker: userPairing[context.payload.assignee.login],
					},
					defaultOptions,
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				break;
			}
			case "unassigned": {
				// Unassigned, check if user has Freelo pairing, is currently assigned to the Freelo task and unassign them
				if (
					!context.payload.assignee ||
					!userPairing[context.payload.assignee.login]
				)
					break;
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				const checkAssignee = await axios.get(
					`${apiEndpoint}/task/${currentTaskId}`,
					defaultOptions,
				);
				if (checkAssignee.status > 399) {
					console.error(checkAssignee.data);
					throw new Error("Got an error response from Freelo API");
				}

				if (
					!checkAssignee.data.worker ||
					checkAssignee.data.worker.id !==
						userPairing[context.payload.assignee.login]
				) {
					// if the current user is not assigned, ignore
					break;
				}

				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId[1]}`,
					{
						worker: null,
					},
					defaultOptions,
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				break;
			}

			default:
				throw new Error("Unknown action passed");
		}
	} else if (comment && issue) {
		// should be an issue comment
		switch (action) {
			case "created": {
				// New comment, add to Freelo task
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				const taskComment = `
                Comment <a href="${comment.url}">${comment.id}</a> by: ${freeloMention(comment.user.login)}<br>
                ${sanitize(comment.body, sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.url}">#${issue.number}</a><br>
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				// Create comment
				const res = await axios.post(
					`${apiEndpoint}/task/${currentTaskId}/comments`,
					{
						content: taskComment,
					},
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				console.log(`Created comment ${res.data.id}`);
				break;
			}
			case "deleted": {
				// Find comment, delete it
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				const getTaskComments = await axios.get(
					`${apiEndpoint}/task/${currentTaskId}`,
					defaultOptions,
				);
				if (getTaskComments.status > 399) {
					console.error(getTaskComments.data);
					throw new Error("Got an error response from Freelo API");
				}

				const findComment = (
					getTaskComments.data.comments as { id: number; content: string }[]
				).filter((c) => />(\d+)</gm.test(c.content));
				if (findComment.length === 0) {
					console.log("Comment found, but no GitHub comment ID identified");
					break;
				}
				const res = await axios.delete(
					`${apiEndpoint}/comment/${findComment[0].id}`,
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				console.log(`Deleted comment ${findComment[0].id}`);
				break;
			}
			case "edited": {
				// Find comment, edit it
				const currentTaskId = await freeloId(issue.number);
				if (!currentTaskId || currentTaskId.length === 1) {
					console.log("Comment found, but no Freelo task ID identified");
					break;
				}

				const getTaskComments = await axios.get(
					`${apiEndpoint}/task/${currentTaskId}`,
					defaultOptions,
				);
				if (getTaskComments.status > 399) {
					console.error(getTaskComments.data);
					throw new Error("Got an error response from Freelo API");
				}

				const findComment = (
					getTaskComments.data.comments as { id: number; content: string }[]
				).filter((c) => />(\d+)</gm.test(c.content));
				if (findComment.length === 0) {
					console.log("Comment found, but no GitHub comment ID identified");
					break;
				}

				const taskComment = `
                Comment <a href="${comment.url}">${comment.id}</a> by: ${freeloMention(comment.user.login)}<br>
                ${sanitize(comment.body, sanitizeOptions)}<br>
                GitHub issue: <a href="${issue.url}">#${issue.number}</a><br>
                <i>(This action was performed automatically, please do not edit this comment)</i>
                `;

				// Create comment
				const res = await axios.post(
					`${apiEndpoint}/comment/${findComment[0].id}`,
					{
						content: taskComment,
					},
				);
				if (res.status > 399) {
					console.error(res.data);
					throw new Error("Got an error response from Freelo API");
				}
				console.log(`Edited comment ${findComment[0].id}`);
				break;
			}
			default:
				break;
		}
	} else {
		console.error("You are running this through an unsupported trigger!");
	}
} catch (error) {
	setFailed((error as Error)?.message ?? "Unknown error");
}
