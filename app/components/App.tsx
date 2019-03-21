import * as React from "react";
import { connect } from "react-redux";
import ConnectionListContainer from "../containers/ConnectionListContainer";
import ConnectionContainer from "../containers/ConnectionContainer";
import Tab from "../ui/Tab";
import { AppState } from "../store";
import { IConnectionState } from "../actions/connection";
import Connection from "../db/Connection";

interface IState {
    isVisible: boolean;
    activeTab: string;
}

interface IProps {
    connection: IConnectionState;
    connectedConnection: any;
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
        this.setState({ activeTab: key });
    }
    public render() {
        const connections = this.props.connectedConnection;
        return (
            <div>
                <Tab active={this.state.activeTab} onChange={this.handleTabChange}>
                    <Tab.Pane closable={false} key="connections" title="Connection List">
                        <ConnectionListContainer />
                    </Tab.Pane>
                    {connections.map((d: Connection) => (<Tab.Pane key={d.name} title={d.name}><ConnectionContainer connection={d}/></Tab.Pane>))}
                </Tab>
            </div>
        );
    }
}

const mapState = ({connection, connectedConnection}: AppState) => ({connection, connectedConnection});
export default connect(mapState)(App);
