import * as React from "react";
import Tab from "../ui/Tab";
import { IContentState } from "../store/content/types";

interface IProps {
    content: IContentState;
    onTabChange: () => void;
}

export default ({content, onTabChange}: IProps) => (
    <section className="content">
        <Tab active={content.active} onChange={onTabChange}>{content.data}</Tab>
    </section>
)