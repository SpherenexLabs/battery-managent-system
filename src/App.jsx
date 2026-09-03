import { EvProvider } from './state/EvContext.jsx';
import { useEvState } from './state/store.js';
import Sidebar from './components/Sidebar.jsx';
import Overview from './screens/Overview.jsx';
import Stations from './screens/Stations.jsx';
import Navigation from './screens/Navigation.jsx';
import Charging from './screens/Charging.jsx';
import Thermal from './screens/Thermal.jsx';
import Health from './screens/Health.jsx';
import './App.css';

const SCREENS = {
  overview: Overview,
  stations: Stations,
  navigation: Navigation,
  charging: Charging,
  thermal: Thermal,
  health: Health,
};

function Shell() {
  const state = useEvState();
  const Screen = SCREENS[state.screen] || Overview;
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        <Screen />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <EvProvider>
      <Shell />
    </EvProvider>
  );
}
