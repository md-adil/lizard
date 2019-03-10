import * as React from "react";
import ConnectionList from "../components/ConnectionList";

interface IState {
    connections: any[];
}

class ConnectionListContainer extends React.Component<{}, IState> {
    public state = {
        connections: [],
    };

    public render() {
        return (
           <ConnectionList connections={this.state.connections}/>
        );
    }
}

export default ConnectionListContainer;
