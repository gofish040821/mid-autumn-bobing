import './Background.css';

/** 一轮淡月、一盏小灯和静止的远山。 */
export default function Background(): JSX.Element {
  return (
    <div className="scenery" aria-hidden="true">
      <div className="scenery__moon" />
      <div className="scenery__lantern scenery__lantern--left">
        <span className="scenery__lantern-cord" />
        <span className="scenery__lantern-body" />
        <span className="scenery__lantern-tassel" />
      </div>
      <svg className="scenery__hills" viewBox="0 0 1440 160" preserveAspectRatio="none" focusable="false">
        <path className="scenery__hills-far" d="M0 140Q180 65 360 115Q520 160 710 95Q930 40 1120 120Q1300 65 1440 100V160H0Z" />
      </svg>
    </div>
  );
}
