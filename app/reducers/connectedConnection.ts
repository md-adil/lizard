import { ADD, DELETE } from "../actions/connectedConnection";
import Connection from "../db/Connection";
const defaultState: Connection[] = [];

export default (state = defaultState, action: any) => {
    switch (action.payload) {
        case ADD:
            return [...state, action.payload];
        case DELETE:
            return state.filter(c => c !== action.payload);
        default:
            return state;
    }
};
