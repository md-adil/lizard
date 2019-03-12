import * as React from "react";
import ConnectionList from "../components/ConnectionList";
import { connect } from "react-redux";
import * as connection from "../actions/connection";

interface IProps {
    dispatch: any;
}

interface IState {
    connections: any[];
}

class ConnectionListContainer extends React.Component<IProps, IState> {
    public state = {
        connections: [],
    };


    handleAddConnection = (e: any) => {
        this.props.dispatch(connection.isCreating(true));
    }

    public render() {
        return (
           <ConnectionList onAddConnection={this.handleAddConnection} connections={this.state.connections}/>
        );
    }
}

const dispatchToProps = (dispatch: any) => ({ dispatch });
export default connect(null, dispatchToProps)(ConnectionListContainer);
