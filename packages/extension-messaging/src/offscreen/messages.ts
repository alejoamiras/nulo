import type {
	EventMessage as BaseEventMessage,
	RequestMessage as BaseRequestMessage,
	ResponseMessage as BaseResponseMessage,
} from "../messages"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"

type MessageExt = {
	from: string
	to?: string
}

export type EventMessage<T extends EventsMap> = BaseEventMessage<T> & MessageExt
export type RequestMessage<T extends MethodsMap> = BaseRequestMessage<T> & MessageExt
export type ResponseMessage<T extends MethodsMap> = BaseResponseMessage<T> & MessageExt
