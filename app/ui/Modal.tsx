import * as React from "react";
import { createPortal } from "react-dom";
import "./modal.scss";

interface IProps {
    title: string;
    visible: boolean;
    onClose: () => void;
}

const modalRoot = document.createElement("div");

class Modal extends React.Component<IProps> {
    private root = modalRoot;

    public componentDidMount(): void {
        document.body.appendChild(this.root);
    }

    public componentWillUnmount(): void {
        document.body.removeChild(this.root);
    }

    public render() {
        if (!this.props.visible) {
            return null;
        }
        return createPortal(
            <div className="ui-modal-backdrop">
                <div className="ui-modal-dialog">
                    <div className="ui-modal-content">
                        <div className="ui-modal-header">
                            <div className="ui-modal-title">{this.props.title}</div>
                            <button className="ui-btn-close" onClick={this.props.onClose}>&times;</button>
                        </div>
                        <div className="ui-modal-body">{this.props.children}</div>
                    </div>
                </div>
            </div>
        , this.root);
    }
}

export default Modal;
