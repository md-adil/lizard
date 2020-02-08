import { IContentAction, Types, IContentState } from "./types";

const defaultState: IContentState = {
    data: []
};

let lastActive: string | undefined;
export default (
    state = defaultState,
    action: IContentAction
): IContentState => {
    switch (action.type) {
        case Types.ADD:
            lastActive = state.active;
            return {
                ...state,
                data: [...state.data, action.payload],
                active: action.payload.key || action.payload.title
            };
        case Types.REMOVE:
            const active = lastActive;
            return {
                ...state,
                active,
                data: state.data.filter((a: any) => a.title !== action.payload)
            };
        case Types.ACTIVE:
            return {
                ...state,
                active: action.payload
            };
        default:
            return state;
    }
};
