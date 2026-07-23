import type { TxOrigin } from "@/wallet/services/transaction/spec"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type TaskService, type ITaskContent, type ITaskResult, EmptyResult, TaskStatus, type Task } from "./service"

export class WrappedTask {
	constructor(
		public readonly id: string,
		private readonly taskService: TaskService,
		public readonly origin?: TxOrigin,
		/** Preallocated task↔journal correlation id (Phase 1a). Set only on
		 *  root feed tasks; read by the dApp-send executor to stamp the same id
		 *  onto the created/claimed journal record so the activity feed can
		 *  bind this task to its owning-scope journal. */
		public readonly correlationId?: string,
	) {}

	public createSubtask(content: ITaskContent): WrappedTask {
		return this.taskService.createNewTask(content, this.id, this.origin)
	}

	public startSubtask(content: ITaskContent): WrappedTask {
		return this.taskService.startNewTask(content, this.id, this.origin)
	}

	public start(): void {
		this.taskService.startTask(this.id)
	}

	public complete(result: ITaskResult = new EmptyResult()): void {
		this.taskService.completeTask(this.id, result)
	}

	public fail(error: unknown): void {
		this.taskService.failTask(this.id, getErrorMessage(error))
	}

	public cancel(): void {
		this.taskService.cancelTask(this.id)
	}

	public get task(): Task {
		return this.taskService.getTaskSync(this.id)
	}

	public get status(): TaskStatus {
		return this.task.status
	}

	public get isFinished(): boolean {
		const status = this.status
		return status === TaskStatus.Completed || status === TaskStatus.Failed || status === TaskStatus.Cancelled
	}
}
