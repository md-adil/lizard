import { AppState } from "..";
import { IContentAction, ADD, REMOVE, IContentState } from "./types";

const defaultState: IContentState = {
    active: "",
    data: []
};

export default (state = defaultState, action: IContentAction): IContentState => {
    switch (action.type) {
        case ADD:
            return { ...state, data: [ ...state.data, action.payload ] };
        case REMOVE:
            return {...state, data: state.data.filter((a) => a !== action.payload)};
        default:
            return state;
    }
};
