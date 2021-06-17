import React from 'react'
import TextEditor from "./Editor"
import './assets/App.css'
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect,
} from "react-router-dom"
import { v4 as uuidV4 } from "uuid"

function App() {
  return (
    <Router>
      <Switch>
        <Route path="/" exact>
          <Redirect to={`/${uuidV4()}`} />
        </Route>
        <Route path="/:id">
          <TextEditor />
        </Route>
      </Switch>
    </Router>
  )
}

export default App
