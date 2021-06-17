import React from 'react'
import TextEditor from "./Editor"
import './assets/App.css'
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect,
} from "react-router-dom"
const { customAlphabet } = require('nanoid')

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 5)  // https://zelark.github.io/nano-id-cc

function App() {
  return (
    <Router>
      <Switch>
        <Route path="/" exact>
          <Redirect to={`/${nanoid()}`} />
        </Route>
        <Route path="/:id">
          <TextEditor />
        </Route>
      </Switch>
    </Router>
  )
}

export default App
