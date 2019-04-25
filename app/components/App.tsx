import * as React from "react";
import { connect } from "react-redux";
import ConnectionListContainer from "../containers/ConnectionListContainer";
import ConnectionContainer from "../containers/ConnectionContainer";
import Tab from "../ui/Tab";
import { AppState } from "../store";
import Connection from "../db/Connection";
import * as connectionAction from "../actions/connection";
import "./app.scss";
import { Dispatch } from "redux";

interface IState {
    isVisible: boolean;
    activeTab: string;
}

interface IProps {
    connections: Connection[];
    activeConnection: string;
    dispatch: Dispatch;
}

class App extends React.Component<IProps, IState> {
    public state = {
        activeTab: "connections",
        isVisible: false,
    };

    public handleButtonClick = () => {
        this.setState({ isVisible: true });
    }

    public handleClose = () => {
        this.setState({ isVisible: false });
    }

    public handleTabChange = (key: string) => {
        this.props.dispatch(connectionAction.active(key));
    }

    public render() {
        const connections = this.props.connections;
        return (
            <div className="connections">
                <Tab active={this.props.activeConnection} className="connection-tabs" onChange={this.handleTabChange}>
                    <Tab.Pane closable={false} key="connections" title="Connection List">
                        <ConnectionListContainer />
                    </Tab.Pane>
                    {connections.map((d: Connection) => d.isConnected && (<Tab.Pane key={d.id} title={d.name}>
                        <ConnectionContainer connection={d} />
                    </Tab.Pane>))}
                </Tab>
            </div>
        );
    }
}

const mapState = ({connection}: AppState) => ({
    connections: connection.data,
    activeConnection: connection.active
});

const mapDispatch = (dispatch: Dispatch) => ({dispatch});

export default connect(mapState, mapDispatch)(App);
