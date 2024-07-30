interface Label {
	name: string;
	color?: string;
}

interface NewTask {
	name: string;
	labels?: Label[];
	worker?: number;
	comment?: { content: string };
}

export type { NewTask, Label };
