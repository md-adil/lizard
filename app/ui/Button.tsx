import classnames from "classnames";
import * as React from "react";
import "./button.scss";
import Icon from "./Icon";

interface IProps {
    children: React.ReactNode;
    onClick ?: () => void;
    isLoading: boolean;
    htmlType?: string;
}

class Button extends React.Component<IProps> {
    public static defaultProps = {
        isLoading: false,
    };

    public render() {
        const { children, isLoading, htmlType, onClick, ...props } = this.props;
        return (
            <button
                type={htmlType}
                onClick={isLoading ? undefined : onClick}
                className={classnames("ui-btn", {"is-loading": isLoading})}
                {...props}
            >
                {children}
            </button>
        );
    }
}

export default Button;
