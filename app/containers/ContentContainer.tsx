import * as React from "react";
import Content from "../components/Content";
import { connect } from "react-redux";
import { AppState } from "../store";
import { IContentState } from "../store/content/types";
import * as contentAction from "../store/content/action";
import { Dispatch } from "redux";

interface IProps {
    content: IContentState;
    dispatch: Dispatch;
}

class ContentContainer extends React.Component<IProps> {
    public handleTabChange = (activeKey: string) => {
        this.props.dispatch(contentAction.active(activeKey));
    };

    public handleClose = (key: string) => {
        this.props.dispatch(contentAction.remove(key));
    };

    public render() {
        return (
            <Content
                content={this.props.content}
                onTabChange={this.handleTabChange}
                onClose={this.handleClose}
            />
        );
    }
}

const mapState = ({ content }: AppState) => ({ content });
const mapDispatch = (dispatch: Dispatch) => ({ dispatch });

export default connect(mapState)(ContentContainer);
