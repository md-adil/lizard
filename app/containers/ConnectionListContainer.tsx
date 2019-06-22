import * as React from "react";
import ConnectionList from "../components/ConnectionList";
import { connect } from "react-redux";
import { AppState } from "../store";
import { Dispatch } from "redux";
import Connection from "../db/Connection";
import * as connectionAction from "../store/connection/action";

interface IProps {
    dispatch: any;
    connections: Connection[];
    isConnectionLoaded: boolean;
}

interface IState {
    connections: any[];
}

class ConnectionListContainer extends React.Component<IProps, IState> {
    public state = {
        connections: [],
    };

    public componentDidMount() {
        if (!this.props.isConnectionLoaded) {
            this.props.dispatch(connectionAction.fetch());
        }
    }

    public handleAddConnection = (e: any) => {
        this.props.dispatch(connectionAction.creating(true));
    }

    public render() {
        return (
            <ConnectionList
                onAddConnection={this.handleAddConnection}
                connections={this.props.connections}
            />
        );
    }
}

const mapStateToProps = ({ connection }: AppState) => ({
    connections: connection.data,
    isConnectionLoaded: connection.isLoaded
});

const dispatchToProps = (dispatch: Dispatch) => ({ dispatch });
export default connect(mapStateToProps, dispatchToProps)(ConnectionListContainer);
