import { ADD, CREATE, ConnectionActionTypes, IConnectionState, UPDATE } from "../actions/connection";

export default (
        state: IConnectionState = { isCreating: false, data: []},
        action: ConnectionActionTypes,
    ): IConnectionState => {
    switch (action.type) {
        case CREATE:
            return { ...state, isCreating: true };
        case ADD:
            return { ...state, data: state.data };
        case UPDATE:
        default:
            return state;
    }
};
