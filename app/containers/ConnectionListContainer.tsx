import * as React from "react";
import ConnectionList from "../components/ConnectionList";
import { connect } from "react-redux";
import * as connection from "../actions/connection";
import { AppState } from "../store";
import { Dispatch } from "redux";

interface IProps {
    dispatch: any;
    connection: connection.IConnectionState;
}

interface IState {
    connections: any[];
}

class ConnectionListContainer extends React.Component<IProps, IState> {
    public state = {
        connections: [],
    };

    public componentDidMount() {
        this.props.dispatch(connection.fetch());
    }

    public handleAddConnection = (e: any) => {
        this.props.dispatch(connection.isCreating(true));
    }

    public render() {
        return (
            <ConnectionList
                onAddConnection={this.handleAddConnection}
                connection={this.props.connection}
            />
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    connection: state.connection
});

const dispatchToProps = (dispatch: Dispatch) => ({ dispatch });
export default connect(mapStateToProps, dispatchToProps)(ConnectionListContainer);
