import * as React from "react";
import Content from "../components/Content";
import { connect } from "react-redux";
import { AppState } from "../store";
import { IContentState } from "../store/content/types";

interface IProps {
    content: IContentState;
}

class ContentContainer extends React.Component<IProps> {

    handleTabChange = () => {
        
    }

    public render() {
        return (
            <Content
                content={this.props.content}
                onTabChange={this.handleTabChange}
            />
        )
    }
}

const mapState = ({content}: AppState) => ({ content })

export default  connect(mapState)(ContentContainer);
