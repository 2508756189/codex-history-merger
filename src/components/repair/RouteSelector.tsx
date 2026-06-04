import type { RepairRoute, RepairRouteId } from '../../lib/repairWizard'

export function RouteSelector(props: {
  routes: RepairRoute[]
  activeRouteId: RepairRouteId
  onSelect: (routeId: RepairRouteId) => void
}) {
  return (
    <nav className="route-selector" aria-label="修复路线">
      {props.routes.map((route) => (
        <button
          aria-pressed={route.id === props.activeRouteId}
          className={route.id === props.activeRouteId ? 'route-card active' : 'route-card'}
          key={route.id}
          type="button"
          onClick={() => props.onSelect(route.id)}
        >
          <strong>{route.title}</strong>
          <span>{route.description}</span>
        </button>
      ))}
    </nav>
  )
}
